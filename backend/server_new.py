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
