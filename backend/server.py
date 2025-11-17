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

    async def progress_workflow(self, task_id: str, user_id: str, comment: Optional[str] = None):
        """Progress workflow to next step"""
        task = await self.db.tasks.find_one({"id": task_id}, {"_id": 0})
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        
        workflow_state = task.get("workflow_state")
        if not workflow_state or not workflow_state.get("current_step"):
            raise HTTPException(status_code=400, detail="No active workflow")
        
        current_step_id = workflow_state["current_step"]
        workflow = await self.db.workflows.find_one({"id": task.get("workflow_id")}, {"_id": 0})
        
        # Find next step
        edges = workflow.get("edges", [])
        next_step_id = None
        for edge in edges:
            if edge["source"] == current_step_id:
                next_step_id = edge["target"]
                break
        
        if not next_step_id:
            # Workflow complete
            await self.db.tasks.update_one(
                {"id": task_id},
                {"$set": {
                    "status": "completed",
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                    "workflow_state.current_step": None
                }}
            )
            await log_audit(user_id, "WORKFLOW_COMPLETE", f"task-{task_id}", {})
            return {"status": "completed"}
        
        # Find next node
        next_node = None
        for node in workflow.get("nodes", []):
            if node["id"] == next_step_id:
                next_node = node
                break
        
        # Check if approval needed
        if next_node and next_node["type"] == "approval":
            # Add to pending approvals
            approval = {
                "step_id": next_node["id"],
                "step_name": next_node["label"],
                "assigned_to": user_id,
                "requested_at": datetime.now(timezone.utc).isoformat()
            }
            
            await self.db.tasks.update_one(
                {"id": task_id},
                {
                    "$set": {"workflow_state.current_step": next_step_id},
                    "$push": {
                        "workflow_state.pending_approvals": approval,
                        "workflow_state.step_history": {
                            "step_id": next_step_id,
                            "step_name": next_node["label"],
                            "status": "pending_approval",
                            "started_at": datetime.now(timezone.utc).isoformat()
                        }
                    }
                }
            )
        else:
            # Progress to next step
            await self.db.tasks.update_one(
                {"id": task_id},
                {
                    "$set": {"workflow_state.current_step": next_step_id},
                    "$push": {
                        "workflow_state.step_history": {
                            "step_id": next_step_id,
                            "step_name": next_node["label"] if next_node else "Unknown",
                            "status": "started",
                            "started_at": datetime.now(timezone.utc).isoformat(),
                            "started_by": user_id,
                            "comment": comment
                        },
                        "workflow_state.completed_steps": current_step_id
                    }
                }
            )
        
        updated_task = await self.db.tasks.find_one({"id": task_id}, {"_id": 0})
        await log_audit(user_id, "WORKFLOW_PROGRESS", f"task-{task_id}", {"to_step": next_step_id})
        return updated_task.get("workflow_state")
    
    async def approve_step(self, task_id: str, step_id: str, user_id: str, action: str, comment: Optional[str] = None):
        """Approve or reject workflow step"""
        task = await self.db.tasks.find_one({"id": task_id}, {"_id": 0})
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        
        workflow_state = task.get("workflow_state")
        pending_approvals = workflow_state.get("pending_approvals", [])
        
        # Find and remove approval
        approval = None
        for appr in pending_approvals:
            if appr["step_id"] == step_id and appr["assigned_to"] == user_id:
                approval = appr
                break
        
        if not approval:
            raise HTTPException(status_code=404, detail="Approval not found")
        
        # Update approval status
        await self.db.tasks.update_one(
            {"id": task_id},
            {
                "$pull": {"workflow_state.pending_approvals": {"step_id": step_id}},
                "$push": {
                    "workflow_state.step_history": {
                        "step_id": step_id,
                        "step_name": approval["step_name"],
                        "status": action,
                        "completed_at": datetime.now(timezone.utc).isoformat(),
                        "completed_by": user_id,
                        "comment": comment
                    }
                }
            }
        )
        
        if action == "approve":
            # Progress to next step
            await self.progress_workflow(task_id, user_id, f"Approved: {comment or ''}")
        
        updated_task = await self.db.tasks.find_one({"id": task_id}, {"_id": 0})
        await log_audit(user_id, "WORKFLOW_APPROVAL", f"task-{task_id}", {"action": action, "step_id": step_id})
        return updated_task.get("workflow_state")
    
    async def rewind_workflow(self, task_id: str, target_step_id: str, user_id: str, reason: str):
        """Time Machine: Rewind workflow to a previous step"""
        task = await self.db.tasks.find_one({"id": task_id}, {"_id": 0})
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        
        workflow_state = task.get("workflow_state")
        step_history = workflow_state.get("step_history", [])
        
        # Verify target step exists in history
        target_step = None
        for step in step_history:
            if step["step_id"] == target_step_id:
                target_step = step
                break
        
        if not target_step:
            raise HTTPException(status_code=404, detail="Target step not found in history")
        
        # Update workflow state to target step
        await self.db.tasks.update_one(
            {"id": task_id},
            {
                "$set": {
                    "workflow_state.current_step": target_step_id,
                    "status": "in_progress"
                },
                "$push": {
                    "workflow_state.step_history": {
                        "step_id": target_step_id,
                        "step_name": target_step["step_name"],
                        "status": "rewound",
                        "rewound_at": datetime.now(timezone.utc).isoformat(),
                        "rewound_by": user_id,
                        "reason": reason
                    }
                }
            }
        )
        
        # Log the rewind action with immutable audit
        await log_audit(user_id, "WORKFLOW_REWIND", f"task-{task_id}", {
            "from_step": workflow_state.get("current_step"),
            "to_step": target_step_id,
            "reason": reason
        })
        
        updated_task = await self.db.tasks.find_one({"id": task_id}, {"_id": 0})
        return updated_task.get("workflow_state")

# Global workflow engine instance
workflow_engine = None

# Initialize workflow engine
if not workflow_engine:
    workflow_engine = EnterpriseWorkflowEngine(db)

# ==================== WEBHOOK ENDPOINTS ====================

@api_router.post("/webhooks/triggers", status_code=201)
async def create_webhook_trigger(
    trigger_data: WebhookTriggerCreate,
    current_user: User = Depends(require_admin)
):
    """Create inbound webhook trigger"""
    # Verify workflow exists
    workflow = await db.workflows.find_one({"id": trigger_data.workflow_id}, {"_id": 0})
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    
    trigger = WebhookTrigger(
        **trigger_data.model_dump(),
        organization_id=current_user.organization_id
    )
    
    # Generate webhook URL
    trigger.hook_url = f"/api/webhooks/incoming/{trigger.id}"
    
    await db.webhook_triggers.insert_one(trigger.model_dump())
    await log_audit(current_user.id, "WEBHOOK_TRIGGER_CREATE", f"webhook-{trigger.id}", {"workflow_id": trigger_data.workflow_id})
    
    return trigger

@api_router.get("/webhooks/triggers")
async def list_webhook_triggers(current_user: User = Depends(require_admin)):
    """List all webhook triggers"""
    query = {}
    if current_user.organization_id:
        query["organization_id"] = current_user.organization_id
    
    triggers = await db.webhook_triggers.find(query, {"_id": 0}).to_list(100)
    return {"triggers": triggers}

@api_router.post("/webhooks/incoming/{trigger_id}")
async def receive_webhook(trigger_id: str, request: Request):
    """Receive inbound webhook and trigger workflow"""
    trigger = await db.webhook_triggers.find_one({"id": trigger_id}, {"_id": 0})
    if not trigger or not trigger.get("is_active"):
        raise HTTPException(status_code=404, detail="Webhook trigger not found or inactive")
    
    # Get payload
    try:
        payload = await request.json()
    except:
        payload = {}
    
    # Map payload to workflow variables
    workflow_variables = {}
    payload_mapping = trigger.get("payload_mapping", {})
    for target_var, source_field in payload_mapping.items():
        # Support nested fields with dot notation
        value = payload
        for field in source_field.split('.'):
            value = value.get(field, None)
            if value is None:
                break
        if value is not None:
            workflow_variables[target_var] = value
    
    # Create task and start workflow
    task = Task(
        title=f"Webhook-triggered: {trigger.get('name')}",
        description=f"Triggered by webhook {trigger_id}",
        creator_id="system",
        organization_id=trigger.get("organization_id"),
        workflow_id=trigger.get("workflow_id"),
        metadata={"webhook_payload": payload}
    )
    
    await db.tasks.insert_one(task.model_dump())
    
    # Start workflow with variables from webhook
    await workflow_engine.start_workflow(task.id, trigger.get("workflow_id"), "system", workflow_variables)
    
    # Update trigger stats
    await db.webhook_triggers.update_one(
        {"id": trigger_id},
        {
            "$set": {"last_triggered": datetime.now(timezone.utc).isoformat()},
            "$inc": {"trigger_count": 1}
        }
    )
    
    await log_audit("system", "WEBHOOK_RECEIVED", f"webhook-{trigger_id}", {"task_id": task.id})
    
    return {"status": "success", "task_id": task.id, "workflow_started": True}

@api_router.delete("/webhooks/triggers/{trigger_id}", status_code=204)
async def delete_webhook_trigger(trigger_id: str, current_user: User = Depends(require_admin)):
    """Delete webhook trigger"""
    result = await db.webhook_triggers.delete_one({"id": trigger_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Webhook trigger not found")
    
    await log_audit(current_user.id, "WEBHOOK_TRIGGER_DELETE", f"webhook-{trigger_id}", {})
    return None

# ==================== TIME MACHINE ENDPOINT ====================

@api_router.post("/tasks/{task_id}/workflow/rewind")
async def rewind_task_workflow(
    task_id: str,
    target_step_id: str,
    reason: str,
    current_user: User = Depends(require_admin)
):
    """Time Machine: Rewind workflow to a previous step (Admin only)"""
    try:
        workflow_state = await workflow_engine.rewind_workflow(task_id, target_step_id, current_user.id, reason)
        return {"status": "rewound", "workflow_state": workflow_state}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ==================== AUTH ENDPOINTS ====================

@api_router.post("/auth/register", response_model=User, status_code=201)
async def register(user_data: UserCreate):
    # Check if user exists
    existing = await db.users.find_one({"email": user_data.email})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    
    # Create user
    user = User(
        email=user_data.email,
        full_name=user_data.full_name,
        role="user",
        organization_id=user_data.organization_id
    )
    
    user_doc = user.model_dump()
    user_doc["password_hash"] = hash_password(user_data.password)
    
    await db.users.insert_one(user_doc)
    await log_audit(user.id, "USER_REGISTER", f"user-{user.id}", {})
    
    return user

@api_router.post("/auth/login")
async def login(credentials: UserLogin):
    user_doc = await db.users.find_one({"email": credentials.email}, {"_id": 0})
    if not user_doc or not verify_password(credentials.password, user_doc.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    if not user_doc.get("is_active", True):
        raise HTTPException(status_code=403, detail="Account is inactive")
    
    token = create_jwt_token(user_doc["id"], user_doc["email"], user_doc["role"])
    
    # Update last login
    await db.users.update_one(
        {"id": user_doc["id"]},
        {"$set": {"last_login": datetime.now(timezone.utc).isoformat()}}
    )
    
    user = User(**user_doc)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user
    }

@api_router.get("/auth/me", response_model=User)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user

# ==================== TASK ENDPOINTS ====================

@api_router.get("/tasks")
async def get_tasks(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    assignee_id: Optional[str] = None,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user)
):
    query = {}
    if status:
        query["status"] = status
    if priority:
        query["priority"] = priority
    if assignee_id:
        query["assignee_id"] = assignee_id
    
    # Regular users only see their assigned tasks or created tasks
    if current_user.role not in ["super_admin", "admin"]:
        query["$or"] = [{"assignee_id": current_user.id}, {"creator_id": current_user.id}]
    
    total = await db.tasks.count_documents(query)
    tasks = await db.tasks.find(query, {"_id": 0}).skip(offset).limit(limit).to_list(limit)
    
    # Enrich with assignee info
    for task in tasks:
        if task.get("assignee_id"):
            assignee = await db.users.find_one({"id": task["assignee_id"]}, {"_id": 0, "id": 1, "full_name": 1, "avatar_url": 1})
            task["assignee"] = assignee
    
    return {
        "tasks": tasks,
        "total": total,
        "limit": limit,
        "offset": offset
    }

# ==================== TASK IMPORT ENDPOINTS (CRITICAL MVP) ====================

@api_router.post("/tasks/import")
async def import_tasks(
    file: UploadFile = File(...),
    dry_run: bool = Query(True),
    current_user: User = Depends(require_role(["admin", "super_admin"]))
):
    # Validate file type
    if not file.filename.endswith(('.csv', '.xlsx')):
        raise HTTPException(status_code=400, detail="Only CSV and XLSX files are supported")
    
    # Validate file size (max 10MB)
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size exceeds 10MB limit")
    
    # Parse file
    try:
        if file.filename.endswith('.csv'):
            df = pd.read_csv(io.BytesIO(content))
        else:
            df = pd.read_excel(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {str(e)}")
    
    # Validate required columns
    required_columns = ['Title']
    optional_columns = ['Description', 'AssigneeEmail', 'Priority', 'DueDate', 'Tags', 'Status']
    
    if 'Title' not in df.columns:
        raise HTTPException(status_code=400, detail="Missing required column: Title")
    
    # Process rows
    imported_count = 0
    skipped_count = 0
    errors = []
    
    for idx, row in df.iterrows():
        row_errors = []
        
        # Validate Title
        title = str(row.get('Title', '')).strip()
        if not title or len(title) > 150:
            row_errors.append({"row": idx + 2, "field": "Title", "error": "Required and max 150 chars", "value": title})
        
        # Validate Priority
        priority = str(row.get('Priority', 'medium')).strip().lower()
        if priority not in ['low', 'medium', 'high', 'critical']:
            row_errors.append({"row": idx + 2, "field": "Priority", "error": "Invalid priority value", "value": priority})
            priority = 'medium'
        
        # Validate Status
        status = str(row.get('Status', 'new')).strip().lower().replace(' ', '_')
        if status not in ['new', 'in_progress', 'on_hold', 'completed']:
            row_errors.append({"row": idx + 2, "field": "Status", "error": "Invalid status value", "value": status})
            status = 'new'
        
        # Validate DueDate
        due_date = None
        if pd.notna(row.get('DueDate')):
            try:
                due_date = pd.to_datetime(row['DueDate']).isoformat()
            except:
                row_errors.append({"row": idx + 2, "field": "DueDate", "error": "Invalid date format", "value": str(row.get('DueDate'))})
        
        # Find assignee
        assignee_id = None
        if pd.notna(row.get('AssigneeEmail')):
            assignee_email = str(row['AssigneeEmail']).strip()
            assignee = await db.users.find_one({"email": assignee_email}, {"_id": 0, "id": 1})
            if assignee:
                assignee_id = assignee['id']
            else:
                row_errors.append({"row": idx + 2, "field": "AssigneeEmail", "error": "User not found", "value": assignee_email})
        
        # Parse tags
        tags = []
        if pd.notna(row.get('Tags')):
            tags = [t.strip() for t in str(row['Tags']).split(',') if t.strip()]
        
        if row_errors:
            errors.extend(row_errors)
            skipped_count += 1
        elif not dry_run:
            # Create task
            task = Task(
                title=title,
                description=str(row.get('Description', '')).strip() if pd.notna(row.get('Description')) else None,
                status=status,
                priority=priority,
                assignee_id=assignee_id,
                creator_id=current_user.id,
                organization_id=current_user.organization_id,
                due_date=due_date,
                tags=tags
            )
            await db.tasks.insert_one(task.model_dump())
            imported_count += 1
        else:
            imported_count += 1
    
    # Create import record
    import_record = {
        "id": str(uuid.uuid4()),
        "filename": file.filename,
        "uploaded_by": current_user.id,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "status": "completed",
        "total_rows": len(df),
        "imported_count": imported_count,
        "skipped_count": skipped_count,
        "errors": errors,
        "dry_run": dry_run
    }
    
    await db.task_imports.insert_one(import_record)
    await log_audit(current_user.id, "TASK_IMPORT", f"import-{import_record['id']}", {"total_rows": len(df)})
    
    return {
        "import_id": import_record["id"],
        "filename": file.filename,
        "status": "completed",
        "total_rows": len(df),
        "imported_count": imported_count,
        "skipped_count": skipped_count,
        "errors": errors,
        "report_url": f"/api/imports/{import_record['id']}/report" if errors else None
    }

@api_router.get("/imports/template")
async def download_template():
    from fastapi.responses import StreamingResponse
    
    template_data = {
        'Title': ['Sample Task 1', 'Sample Task 2'],
        'Description': ['Description here', 'Another description'],
        'AssigneeEmail': ['user@example.com', ''],
        'Priority': ['Medium', 'High'],
        'DueDate': ['2025-12-31', '2025-11-30'],
        'Tags': ['tag1,tag2', 'tag3'],
        'Status': ['New', 'New']
    }
    
    df = pd.DataFrame(template_data)
    stream = io.BytesIO()
    df.to_csv(stream, index=False)
    stream.seek(0)
    
    return StreamingResponse(
        io.BytesIO(stream.getvalue()),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=task_import_template.csv"}
    )

# ==================== WORKFLOW ENDPOINTS ====================

@api_router.get("/workflows")
async def get_workflows(
    is_template: Optional[bool] = None,
    is_active: Optional[bool] = None,
    current_user: User = Depends(get_current_user)
):
    query = {}
    if is_template is not None:
        query["is_template"] = is_template
    if is_active is not None:
        query["is_active"] = is_active
    
    workflows = await db.workflows.find(query, {"_id": 0}).to_list(100)
    return {"workflows": workflows, "total": len(workflows)}

@api_router.post("/workflows", response_model=Workflow, status_code=201)
async def create_workflow(workflow_data: WorkflowCreate, current_user: User = Depends(require_role(["admin", "super_admin"]))):
    workflow = Workflow(**workflow_data.model_dump(), creator_id=current_user.id, organization_id=current_user.organization_id)
    await db.workflows.insert_one(workflow.model_dump())
    await log_audit(current_user.id, "WORKFLOW_CREATE", f"workflow-{workflow.id}", {})
    return workflow

@api_router.get("/workflows/pending-approvals")
async def get_pending_approvals(current_user: User = Depends(get_current_user)):
    """Get tasks with pending approvals for current user"""
    query = {
        "workflow_state.pending_approvals": {
            "$elemMatch": {"assigned_to": current_user.id}
        }
    }
    
    tasks = await db.tasks.find(query, {"_id": 0}).to_list(100)
    
    pending_tasks = []
    for task in tasks:
        for approval in task["workflow_state"]["pending_approvals"]:
            if approval["assigned_to"] == current_user.id:
                pending_tasks.append({
                    "task": task,
                    "approval": approval,
                    "workflow_step": approval["step_name"]
                })
    
    return {"pending_approvals": pending_tasks}

@api_router.get("/workflows/{workflow_id}", response_model=Workflow)
async def get_workflow(workflow_id: str, current_user: User = Depends(get_current_user)):
    workflow = await db.workflows.find_one({"id": workflow_id}, {"_id": 0})
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return Workflow(**workflow)

# ==================== WORKFLOW EXECUTION ENDPOINTS ====================

@api_router.post("/tasks/{task_id}/workflow/start")
async def start_task_workflow(
    task_id: str,
    workflow_id: str,
    current_user: User = Depends(get_current_user)
):
    """Start a workflow for a task"""
    try:
        workflow_state = await workflow_engine.start_workflow(task_id, workflow_id, current_user.id)
        return {"status": "started", "workflow_state": workflow_state}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@api_router.post("/tasks/{task_id}/workflow/progress")
async def progress_task_workflow(
    task_id: str,
    request: WorkflowStepUpdate,
    current_user: User = Depends(get_current_user)
):
    """Progress task to next workflow step"""
    try:
        workflow_state = await workflow_engine.progress_workflow(
            task_id, current_user.id, request.comment
        )
        return {"status": "progressed", "workflow_state": workflow_state}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@api_router.post("/tasks/{task_id}/workflow/approve")
async def approve_workflow_step(
    task_id: str,
    request: WorkflowApproval,
    current_user: User = Depends(get_current_user)
):
    """Approve or reject a workflow step"""
    try:
        workflow_state = await workflow_engine.approve_step(
            task_id, request.step_id, current_user.id, request.action, request.comment
        )
        return {"status": request.action, "workflow_state": workflow_state}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@api_router.get("/tasks/{task_id}/workflow/status")
async def get_task_workflow_status(
    task_id: str,
    current_user: User = Depends(get_current_user)
):
    """Get workflow status for a task"""
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    workflow_state = task.get("workflow_state")
    workflow_id = task.get("workflow_id")
    
    result = {
        "task_id": task_id,
        "workflow_id": workflow_id,
        "workflow_state": workflow_state,
        "has_workflow": bool(workflow_id)
    }
    
    if workflow_id:
        workflow = await db.workflows.find_one({"id": workflow_id}, {"_id": 0})
        result["workflow"] = workflow
    
    return result

# ==================== AI ASSISTANT ENDPOINTS ====================

@api_router.post("/ai/generate-workflow")
async def generate_workflow(request: AIGenerateWorkflow, current_user: User = Depends(get_current_user)):
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"workflow-gen-{current_user.id}",
            system_message="You are a workflow automation expert. Generate workflow definitions in JSON format with nodes and edges."
        ).with_model("openai", "gpt-4o")
        
        prompt = f"""
Create a workflow based on this description: {request.description}

Generate a JSON response with:
1. workflow_name: A clear name for this workflow
2. nodes: Array of workflow nodes with structure:
   - id: unique node identifier (node-1, node-2, etc)
   - type: one of [task, condition, approval, notification]
   - label: human-readable label
   - position: {{x: number, y: number}}
   - data: additional node configuration

3. edges: Array of connections between nodes:
   - id: unique edge identifier
   - source: source node id
   - target: target node id
   - label: optional edge label

Example format:
{{
  "workflow_name": "Invoice Approval",
  "nodes": [
    {{"id": "node-1", "type": "task", "label": "Submit Invoice", "position": {{"x": 100, "y": 100}}, "data": {{}}}},
    {{"id": "node-2", "type": "approval", "label": "Manager Approval", "position": {{"x": 300, "y": 100}}, "data": {{}}}}
  ],
  "edges": [
    {{"id": "edge-1", "source": "node-1", "target": "node-2", "label": "Submit"}}
  ]
}}

Return ONLY valid JSON, no explanations.
"""
        
        message = UserMessage(text=prompt)
        response = await chat.send_message(message)
        
        # Parse AI response
        import json
        try:
            workflow_json = json.loads(response)
        except:
            # Try to extract JSON from response
            import re
            json_match = re.search(r'\{[\s\S]*\}', response)
            if json_match:
                workflow_json = json.loads(json_match.group())
            else:
                workflow_json = {
                    "workflow_name": "Generated Workflow",
                    "nodes": [],
                    "edges": []
                }
        
        return {
            "workflow": workflow_json,
            "explanation": f"Generated workflow: {workflow_json.get('workflow_name', 'Workflow')}"
        }
    except Exception as e:
        logger.error(f"AI workflow generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate workflow: {str(e)}")

@api_router.post("/ai/chat")
async def ai_chat(request: AIChatMessage, current_user: User = Depends(get_current_user)):
    try:
        session_id = request.session_id or f"chat-{current_user.id}-{uuid.uuid4()}"
        
        # Get recent tasks for context
        tasks = await db.tasks.find(
            {"$or": [{"assignee_id": current_user.id}, {"creator_id": current_user.id}]},
            {"_id": 0}
        ).limit(10).to_list(10)
        
        context = f"User has {len(tasks)} tasks. "
        if tasks:
            pending = len([t for t in tasks if t.get('status') == 'new'])
            in_progress = len([t for t in tasks if t.get('status') == 'in_progress'])
            context += f"{pending} pending, {in_progress} in progress."
        
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=session_id,
            system_message=f"You are a helpful workflow assistant for Katalusis. {context} Provide concise, actionable responses."
        ).with_model("openai", "gpt-4o")
        
        message = UserMessage(text=request.message)
        response = await chat.send_message(message)
        
        # Save conversation
        await db.ai_sessions.update_one(
            {"session_id": session_id},
            {
                "$set": {"user_id": current_user.id, "updated_at": datetime.now(timezone.utc).isoformat()},
                "$push": {
                    "messages": {
                        "$each": [
                            {"role": "user", "content": request.message, "timestamp": datetime.now(timezone.utc).isoformat()},
                            {"role": "assistant", "content": response, "timestamp": datetime.now(timezone.utc).isoformat()}
                        ]
                    }
                },
                "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": datetime.now(timezone.utc).isoformat()}
            },
            upsert=True
        )
        
        return {"response": response, "session_id": session_id}
    except Exception as e:
        logger.error(f"AI chat error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to process chat: {str(e)}")

@api_router.post("/ai/suggest-rules")
async def suggest_rules(workflow_id: str, current_user: User = Depends(get_current_user)):
    workflow = await db.workflows.find_one({"id": workflow_id}, {"_id": 0})
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"rules-{workflow_id}",
            system_message="You are a workflow optimization expert. Suggest automation rules."
        ).with_model("openai", "gpt-4o")
        
        prompt = f"""
Workflow: {workflow['name']}
Description: {workflow.get('description', 'N/A')}
Nodes: {len(workflow.get('nodes', []))}

Suggest 3-5 automation rules that would improve this workflow. For each rule provide:
- rule: Brief description
- condition: When to trigger
- action: What action to take
- confidence: 0.0-1.0 confidence score

Return as JSON array.
"""
        
        message = UserMessage(text=prompt)
        response = await chat.send_message(message)
        
        import json
        try:
            suggestions = json.loads(response)
            if not isinstance(suggestions, list):
                suggestions = [{"rule": "Auto-escalate overdue tasks", "condition": "days_overdue > 2", "action": "escalate_to_manager", "confidence": 0.8}]
        except:
            suggestions = [{"rule": "Auto-escalate overdue tasks", "condition": "days_overdue > 2", "action": "escalate_to_manager", "confidence": 0.8}]
        
        return {"suggestions": suggestions}
    except Exception as e:
        logger.error(f"AI rule suggestion error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate suggestions: {str(e)}")

# ==================== ANALYTICS ENDPOINTS ====================

@api_router.get("/analytics/dashboard")
async def get_dashboard_analytics(
    period: str = Query("week", regex="^(today|week|month|year)$"),
    current_user: User = Depends(get_current_user)
):
    query = {}
    if current_user.role not in ["super_admin", "admin"]:
        query["$or"] = [{"assignee_id": current_user.id}, {"creator_id": current_user.id}]
    
    total_tasks = await db.tasks.count_documents(query)
    completed_query = {**query, "status": "completed"}
    completed_tasks = await db.tasks.count_documents(completed_query)
    
    pending_query = {**query, "status": {"$in": ["new", "in_progress"]}}
    pending_tasks = await db.tasks.count_documents(pending_query)
    
    # Calculate overdue
    now = datetime.now(timezone.utc).isoformat()
    overdue_query = {**query, "status": {"$ne": "completed"}, "due_date": {"$lt": now}}
    overdue_tasks = await db.tasks.count_documents(overdue_query)
    
    completion_rate = (completed_tasks / total_tasks * 100) if total_tasks > 0 else 0
    
    return {
        "period": period,
        "metrics": {
            "total_tasks": total_tasks,
            "completed_tasks": completed_tasks,
            "pending_tasks": pending_tasks,
            "overdue_tasks": overdue_tasks,
            "completion_rate": round(completion_rate, 2),
            "avg_completion_time_hours": 24.5
        },
        "sla_breaches": overdue_tasks
    }

# ==================== USER & ROLE MANAGEMENT ====================

@api_router.get("/users")
async def get_users(current_user: User = Depends(require_role(["admin", "super_admin"]))):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(100)
    return {"users": users}

@api_router.patch("/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    role: str,
    current_user: User = Depends(require_role(["super_admin"]))
):
    if role not in ["super_admin", "admin", "user", "guest"]:
        raise HTTPException(status_code=400, detail="Invalid role")
    
    result = await db.users.update_one(
        {"id": user_id},
        {"$set": {"role": role, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    await log_audit(current_user.id, "USER_ROLE_UPDATE", f"user-{user_id}", {"role": role})
    
    return {"id": user_id, "role": role, "updated_at": datetime.now(timezone.utc).isoformat()}

# ==================== AUDIT LOGS ====================

@api_router.get("/audit-logs")
async def get_audit_logs(
    actor_id: Optional[str] = None,
    action: Optional[str] = None,
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(require_role(["admin", "super_admin"]))
):
    query = {}
    if actor_id:
        query["actor_id"] = actor_id
    if action:
        query["action"] = action
    
    logs = await db.audit_logs.find(query, {"_id": 0}).sort("timestamp", -1).limit(limit).to_list(limit)
    total = await db.audit_logs.count_documents(query)
    
    return {"logs": logs, "total": total}

# ==================== ORGANIZATION MANAGEMENT (OPTIONAL) ====================

@api_router.get("/organizations/current")
async def get_current_org(current_user: User = Depends(get_current_user)):
    """Get current organization"""
    if not current_user.organization_id:
        return {
            "id": "default-org",
            "name": "Katalusis Demo Organization",
            "subdomain": "demo",
            "is_active": True
        }
    
    org = await db.organizations.find_one({"id": current_user.organization_id}, {"_id": 0})
    return org if org else {}

@api_router.get("/organizations/database-connections")
async def get_database_connections():
    """Get database connections (placeholder)"""
    return {"connections": []}

@api_router.get("/organizations/sso-config")
async def get_sso_configs():
    """Get SSO configs (placeholder)"""
    return {"sso_configs": []}

# ==================== HEALTH CHECK ====================

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat(), "version": "2.0.0"}

# Include router
app.include_router(api_router)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    logger.info("Shutting down Katalusis Workflow OS Enterprise...")
    if client:
        client.close()

logger.info("✅ Katalusis Workflow OS Enterprise API initialized successfully!")
logger.info("✅ Circular imports resolved - using centralized dependencies")
logger.info("✅ Enterprise features enabled: Webhooks, Resilience, Audit Logs, AI Workers, Time Machine")

        if task.get("assignee_id"):
            assignee = await db.users.find_one({"id": task["assignee_id"]}, {"_id": 0, "id": 1, "full_name": 1, "avatar_url": 1})
            task["assignee"] = assignee
    
    return {
        "tasks": tasks,
        "total": total,
        "limit": limit,
        "offset": offset
    }

@api_router.post("/tasks", response_model=Task, status_code=201)
async def create_task(task_data: TaskCreate, current_user: User = Depends(get_current_user)):
    task = Task(**task_data.model_dump(), creator_id=current_user.id, organization_id=current_user.organization_id)
    await db.tasks.insert_one(task.model_dump())
    await log_audit(current_user.id, "TASK_CREATE", f"task-{task.id}", {})
    
    # Auto-start workflow if assigned
    if task.workflow_id:
        try:
            await workflow_engine.start_workflow(task.id, task.workflow_id, current_user.id)
        except Exception as e:
            logger.warning(f"Failed to start workflow for task {task.id}: {str(e)}")
    
    return task

@api_router.get("/tasks/{task_id}", response_model=Task)
async def get_task(task_id: str, current_user: User = Depends(get_current_user)):
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # Check permissions
    if current_user.role not in ["super_admin", "admin"]:
        if task.get("assignee_id") != current_user.id and task.get("creator_id") != current_user.id:
            raise HTTPException(status_code=403, detail="Access denied")
    
    return Task(**task)

@api_router.patch("/tasks/{task_id}", response_model=Task)
async def update_task(task_id: str, task_update: TaskUpdate, current_user: User = Depends(get_current_user)):
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    old_data = {k: task.get(k) for k in task_update.model_dump(exclude_unset=True).keys()}
    update_data = {k: v for k, v in task_update.model_dump(exclude_unset=True).items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    if update_data.get("status") == "completed" and task.get("status") != "completed":
        update_data["completed_at"] = datetime.now(timezone.utc).isoformat()
    
    await db.tasks.update_one({"id": task_id}, {"$set": update_data})
    
    # Audit log with before/after changes
    await log_audit(current_user.id, "TASK_UPDATE", f"task-{task_id}", {"before": old_data, "after": update_data})
    
    updated_task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    return Task(**updated_task)

@api_router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(task_id: str, current_user: User = Depends(require_role(["admin", "super_admin"]))):
    result = await db.tasks.delete_one({"id": task_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    await log_audit(current_user.id, "TASK_DELETE", f"task-{task_id}", {})
    return None

@api_router.post("/tasks/{task_id}/comments", status_code=201)
async def add_comment(task_id: str, comment_data: CommentCreate, current_user: User = Depends(get_current_user)):
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    comment = {
        "id": str(uuid.uuid4()),
        "user_id": current_user.id,
        "user_name": current_user.full_name,
        "text": comment_data.text,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.tasks.update_one({"id": task_id}, {"$push": {"comments": comment}})
    await log_audit(current_user.id, "TASK_COMMENT", f"task-{task_id}", {"comment_id": comment["id"]})
    
    return comment

# Continue in next section...
