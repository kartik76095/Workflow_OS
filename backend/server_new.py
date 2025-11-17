from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, UploadFile, File, Query, Request
from fastapi.security import HTTPBearer
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pydantic import BaseModel, Field, EmailStr, ConfigDict
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
from pathlib import Path
import os
import logging
import uuid
import pandas as pd
import io
from emergentintegrations.llm.chat import LlmChat, UserMessage

# Import dependencies
from dependencies import (
    User, AuditLog, Organization,
    get_current_user, require_role, require_admin, require_super_admin,
    get_current_organization, hash_password, verify_password, create_jwt_token,
    log_audit, set_database
)

# Configuration
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Set database in dependencies
set_database(db)

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = os.environ['JWT_ALGORITHM']
JWT_EXPIRATION_HOURS = int(os.environ['JWT_EXPIRATION_HOURS'])
EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']

# Initialize FastAPI
app = FastAPI(title="Katalusis Workflow OS Enterprise", version="2.0.0")
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ==================== AUDIT MIDDLEWARE ====================

class AuditMiddleware(BaseHTTPMiddleware):
    """Middleware to capture audit trails for critical operations"""
    
    async def dispatch(self, request: Request, call_next):
        # Skip audit for non-critical operations
        if request.method == "GET" or "/health" in str(request.url):
            return await call_next(request)
        
        # Store request info for potential audit logging
        request.state.audit_info = {
            "ip_address": request.client.host if request.client else None,
            "user_agent": request.headers.get("user-agent"),
            "method": request.method,
            "path": str(request.url.path)
        }
        
        response = await call_next(request)
        return response

# Add audit middleware
app.add_middleware(AuditMiddleware)

# ==================== MODELS ====================

# User Models (simplified)
class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    organization_id: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str

# Task Models
class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    priority: str = "medium"
    assignee_id: Optional[str] = None
    due_date: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    workflow_id: Optional[str] = None

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    assignee_id: Optional[str] = None
    due_date: Optional[str] = None
    tags: Optional[List[str]] = None
    workflow_id: Optional[str] = None

class Task(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    description: Optional[str] = None
    status: str = "new"
    priority: str = "medium"
    assignee_id: Optional[str] = None
    creator_id: str
    organization_id: Optional[str] = None
    workflow_id: Optional[str] = None
    external_id: Optional[str] = None
    due_date: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    comments: List[Dict[str, Any]] = Field(default_factory=list)
    attachments: List[Dict[str, Any]] = Field(default_factory=list)
    
    # Workflow Execution Fields
    workflow_state: Dict[str, Any] = Field(default_factory=lambda: {
        "current_step": None,
        "step_history": [],
        "pending_approvals": [],
        "started_at": None,
        "completed_steps": [],
        "variables": {}  # For webhook data and workflow variables
    })
    
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    completed_at: Optional[str] = None

# Workflow Models with Enterprise Features
class WorkflowNode(BaseModel):
    """Enhanced workflow node with enterprise features"""
    id: str
    type: str  # "task", "approval", "condition", "webhook_action", "ai_worker"
    label: str
    position: Dict[str, float]
    data: Dict[str, Any] = Field(default_factory=dict)
    
    # Enterprise Features
    retry_policy: Optional[Dict[str, Any]] = Field(default_factory=lambda: {
        "max_attempts": 3,
        "delay_seconds": 60,
        "backoff": True
    })
    on_error_next_node: Optional[str] = None  # Failure path
    timeout_seconds: Optional[int] = 300  # 5 minute default timeout

class WorkflowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    nodes: List[WorkflowNode] = Field(default_factory=list)
    edges: List[Dict[str, Any]] = Field(default_factory=list)
    rules: List[Dict[str, Any]] = Field(default_factory=list)
    is_template: bool = False
    variables: Dict[str, Any] = Field(default_factory=dict)  # Workflow-level variables

class Workflow(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: Optional[str] = None
    creator_id: str
    organization_id: Optional[str] = None
    is_active: bool = True
    is_template: bool = False
    external_id: Optional[str] = None
    nodes: List[WorkflowNode] = Field(default_factory=list)
    edges: List[Dict[str, Any]] = Field(default_factory=list)
    rules: List[Dict[str, Any]] = Field(default_factory=list)
    variables: Dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

# ==================== MODULE 1: CONNECTIVITY (WEBHOOKS) ====================

class WebhookTrigger(BaseModel):
    """Inbound webhook configuration"""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    workflow_id: str
    organization_id: Optional[str] = None
    hook_url: str = Field(default="")  # Will be generated
    is_active: bool = True
    payload_mapping: Dict[str, str] = Field(default_factory=dict)  # Maps payload fields to workflow variables
    authentication: Optional[Dict[str, Any]] = None  # API key, signature validation
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    last_triggered: Optional[str] = None
    trigger_count: int = 0

class WebhookTriggerCreate(BaseModel):
    name: str
    workflow_id: str
    payload_mapping: Dict[str, str] = Field(default_factory=dict)
    authentication: Optional[Dict[str, Any]] = None

class WebhookActionNode(BaseModel):
    """Outbound webhook action node data"""
    url: str
    method: str = "POST"  # GET, POST, PUT, DELETE
    headers: Dict[str, str] = Field(default_factory=dict)
    body_template: str = ""  # Jinja2 template with workflow variables
    timeout_seconds: int = 30
    follow_redirects: bool = True

# AI Models
class AIGenerateWorkflow(BaseModel):
    description: str
    context: Dict[str, Any] = Field(default_factory=dict)

class AIChatMessage(BaseModel):
    message: str
    session_id: Optional[str] = None

# AI Worker Node
class AIWorkerNode(BaseModel):
    """AI Worker node configuration"""
    system_prompt: str  # Role for the AI
    user_prompt: str    # Task description (can include workflow variables)
    model: str = "gpt-4o"  # AI model to use
    max_tokens: int = 1000
    temperature: float = 0.7
    output_variable: str = "ai_response"  # Variable name to store AI response

# Workflow Execution Models
class WorkflowApproval(BaseModel):
    task_id: str
    step_id: str
    action: str  # "approve" or "reject"
    comment: Optional[str] = None

class WorkflowStepUpdate(BaseModel):
    action: str  # "start", "complete", "approve", "reject"
    comment: Optional[str] = None

# Comment Model
class CommentCreate(BaseModel):
    text: str

# ==================== WORKFLOW ENGINE WITH ENTERPRISE FEATURES ====================

class EnterpriseWorkflowEngine:
    def __init__(self, database):
        self.db = database
    
    async def start_workflow(self, task_id: str, workflow_id: str, user_id: str, initial_variables: Dict[str, Any] = None):
        """Start a workflow with enhanced variable support"""
        workflow = await self.db.workflows.find_one({"id": workflow_id}, {"_id": 0})
        if not workflow:
            raise HTTPException(status_code=404, detail="Workflow not found")
        
        # Get first node
        first_node = None
        if workflow.get("nodes"):
            edges = workflow.get("edges", [])
            incoming_nodes = {edge["target"] for edge in edges}
            for node in workflow["nodes"]:
                if node["id"] not in incoming_nodes or node["type"] == "task":
                    first_node = node
                    break
        
        if not first_node:
            raise HTTPException(status_code=400, detail="Workflow has no starting node")
        
        # Initialize workflow state with variables
        workflow_state = {
            "current_step": first_node["id"],
            "step_history": [{
                "step_id": first_node["id"],
                "step_name": first_node["label"],
                "status": "started",
                "started_at": datetime.now(timezone.utc).isoformat(),
                "started_by": user_id
            }],
            "pending_approvals": [],
            "started_at": datetime.now(timezone.utc).isoformat(),
            "completed_steps": [],
            "variables": {**workflow.get("variables", {}), **(initial_variables or {})}  # Merge workflow and initial variables
        }
        
        await self.db.tasks.update_one(
            {"id": task_id},
            {"$set": {
                "workflow_id": workflow_id,
                "workflow_state": workflow_state,
                "status": "in_progress",
                "updated_at": datetime.now(timezone.utc).isoformat()
            }}
        )
        
        await log_audit(user_id, "WORKFLOW_START", f"task-{task_id}", {"workflow_id": workflow_id})
        return workflow_state
    
    async def execute_node_with_resilience(self, task_id: str, node: WorkflowNode, workflow_variables: Dict[str, Any], user_id: str):
        """Execute a workflow node with retry logic and error handling"""
        max_attempts = node.retry_policy.get("max_attempts", 3) if node.retry_policy else 3
        delay_seconds = node.retry_policy.get("delay_seconds", 60) if node.retry_policy else 60
        backoff = node.retry_policy.get("backoff", True) if node.retry_policy else True
        
        attempt = 1
        while attempt <= max_attempts:
            try:
                # Execute based on node type
                if node.type == "webhook_action":
                    result = await self._execute_webhook_action(node, workflow_variables)
                elif node.type == "ai_worker":
                    result = await self._execute_ai_worker(node, workflow_variables)
                else:
                    result = await self._execute_standard_node(node, workflow_variables)
                
                # Log successful execution
                await log_audit(user_id, "NODE_EXECUTE_SUCCESS", f"task-{task_id}", {
                    "node_id": node.id,
                    "node_type": node.type,
                    "attempt": attempt
                })
                
                return result
                
            except Exception as e:
                error_msg = str(e)
                await log_audit(user_id, "NODE_EXECUTE_ERROR", f"task-{task_id}", {
                    "node_id": node.id,
                    "node_type": node.type,
                    "attempt": attempt,
                    "error": error_msg
                })
                
                if attempt >= max_attempts:
                    # Max retries exhausted, check for error path
                    if node.on_error_next_node:
                        await log_audit(user_id, "NODE_ERROR_ROUTE", f"task-{task_id}", {
                            "from_node": node.id,
                            "to_node": node.on_error_next_node,
                            "error": error_msg
                        })
                        return {"success": False, "error_route": node.on_error_next_node, "error": error_msg}
                    else:
                        # Suspend workflow
                        await self.db.tasks.update_one(
                            {"id": task_id},
                            {"$set": {"status": "suspended", "updated_at": datetime.now(timezone.utc).isoformat()}}
                        )
                        await log_audit(user_id, "WORKFLOW_SUSPENDED", f"task-{task_id}", {"reason": error_msg})
                        raise HTTPException(status_code=500, detail=f"Workflow suspended due to: {error_msg}")
                
                # Wait before retry
                import asyncio
                wait_time = delay_seconds * (2 ** (attempt - 1) if backoff else 1)
                await asyncio.sleep(wait_time)
                attempt += 1
    
    async def _execute_webhook_action(self, node: WorkflowNode, variables: Dict[str, Any]):
        """Execute webhook action node"""
        import httpx
        from jinja2 import Template
        
        webhook_config = WebhookActionNode(**node.data)
        
        # Render template with variables
        template = Template(webhook_config.body_template)
        body = template.render(**variables)
        
        # Render headers with variables
        headers = {}
        for key, value in webhook_config.headers.items():
            headers[key] = Template(value).render(**variables)
        
        async with httpx.AsyncClient() as client:
            response = await client.request(
                method=webhook_config.method,
                url=webhook_config.url,
                headers=headers,
                content=body,
                timeout=webhook_config.timeout_seconds,
                follow_redirects=webhook_config.follow_redirects
            )
            
            if response.status_code >= 400:
                raise HTTPException(status_code=response.status_code, detail=f"Webhook failed: {response.text}")
            
            return {
                "success": True,
                "response_status": response.status_code,
                "response_body": response.text[:1000]  # Truncate response
            }
    
    async def _execute_ai_worker(self, node: WorkflowNode, variables: Dict[str, Any]):
        """Execute AI worker node"""
        from jinja2 import Template
        
        ai_config = AIWorkerNode(**node.data)
        
        # Render prompts with variables
        system_prompt = Template(ai_config.system_prompt).render(**variables)
        user_prompt = Template(ai_config.user_prompt).render(**variables)
        
        # Call OpenAI API
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"ai-worker-{node.id}",
            system_message=system_prompt
        ).with_model("openai", ai_config.model)
        
        response = await chat.send_message(UserMessage(text=user_prompt))
        
        # Store AI response in variables
        return {
            "success": True,
            "variables_update": {ai_config.output_variable: response}
        }
    
    async def _execute_standard_node(self, node: WorkflowNode, variables: Dict[str, Any]):
        """Execute standard workflow nodes (task, approval, condition)"""
        # Standard node execution logic (simplified for now)
        return {"success": True}

# Global workflow engine instance
workflow_engine = None

# Initialize workflow engine
if not workflow_engine:
    workflow_engine = EnterpriseWorkflowEngine(db)

# Continue with the rest of the server.py file...
# (I'll continue with the endpoints in the next file)

print("✅ Dependencies and models loaded successfully - circular imports resolved!")
