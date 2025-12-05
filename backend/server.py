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

# ===========================================================
# START: Local AI Placeholder
# ===========================================================
class UserMessage:
    def __init__(self, content):
        self.content = content

class LlmChat:
    def __init__(self, model=None, api_key=None):
        self.model = model

    def generate(self, messages, **kwargs):
        return "⚠️ AI features are currently disabled in Local Docker mode."
        
    def send(self, *args, **kwargs):
        return self.generate(args)
# ===========================================================
# END: Local AI Placeholder
# ===========================================================

from dependencies import (
    User, AuditLog, Organization,
    get_current_user, require_role, require_admin, require_super_admin,
    get_current_organization, hash_password, verify_password, create_jwt_token,
    log_audit, set_database
)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]
set_database(db)

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = os.environ['JWT_ALGORITHM']
JWT_EXPIRATION_HOURS = int(os.environ['JWT_EXPIRATION_HOURS'])
EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']

app = FastAPI(title="Katalusis Workflow OS Enterprise", version="2.0.0")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "GET" or "/health" in str(request.url):
            return await call_next(request)
        request.state.audit_info = {
            "ip_address": request.client.host if request.client else None,
            "user_agent": request.headers.get("user-agent"),
            "method": request.method,
            "path": str(request.url.path)
        }
        response = await call_next(request)
        return response

app.add_middleware(AuditMiddleware)

# ==================== MODELS ====================

class TenantOnboard(BaseModel):
    company_name: str
    admin_email: EmailStr
    admin_name: str

class Organization(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    is_active: bool = True

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    organization_id: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    priority: str = "medium"
    assignee_id: Optional[str] = None
    due_date: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    workflow_id: Optional[str] = None
    assignee_id: Optional[str] = None
    assignee_group: Optional[str] = None

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    assignee_id: Optional[str] = None
    due_date: Optional[str] = None
    tags: Optional[List[str]] = None
    workflow_id: Optional[str] = None
    assignee_id: Optional[str] = None
    assignee_group: Optional[str] = None

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
    assignee_id: Optional[str] = None
    assignee_group: Optional[str] = None
    workflow_state: Dict[str, Any] = Field(default_factory=lambda: {
        "current_step": None,
        "step_history": [],
        "pending_approvals": [],
        "started_at": None,
        "completed_steps": [],
        "variables": {} 
    })
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    completed_at: Optional[str] = None

class WorkflowNode(BaseModel):
    id: str
    type: str 
    label: str
    position: Dict[str, float]
    data: Dict[str, Any] = Field(default_factory=dict)
    retry_policy: Optional[Dict[str, Any]] = Field(default_factory=lambda: {
        "max_attempts": 3,
        "delay_seconds": 60,
        "backoff": True
    })
    on_error_next_node: Optional[str] = None
    timeout_seconds: Optional[int] = 300 

class WorkflowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    nodes: List[WorkflowNode] = Field(default_factory=list)
    edges: List[Dict[str, Any]] = Field(default_factory=list)
    rules: List[Dict[str, Any]] = Field(default_factory=list)
    is_template: bool = False
    variables: Dict[str, Any] = Field(default_factory=dict)
    global_schema: List[Dict[str, Any]] = Field(default_factory=list)

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
    global_schema: List[Dict[str, Any]] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class WebhookTrigger(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    workflow_id: str
    organization_id: Optional[str] = None
    hook_url: str = Field(default="")
    is_active: bool = True
    payload_mapping: Dict[str, str] = Field(default_factory=dict)
    authentication: Optional[Dict[str, Any]] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    last_triggered: Optional[str] = None
    trigger_count: int = 0

class WebhookTriggerCreate(BaseModel):
    name: str
    workflow_id: str
    payload_mapping: Dict[str, str] = Field(default_factory=dict)
    authentication: Optional[Dict[str, Any]] = None

class WebhookActionNode(BaseModel):
    url: str
    method: str = "POST"
    headers: Dict[str, str] = Field(default_factory=dict)
    body_template: str = ""
    timeout_seconds: int = 30
    follow_redirects: bool = True

class AIGenerateWorkflow(BaseModel):
    description: str
    context: Dict[str, Any] = Field(default_factory=dict)

class AIChatMessage(BaseModel):
    message: str
    session_id: Optional[str] = None

class AIWorkerNode(BaseModel):
    system_prompt: str
    user_prompt: str
    model: str = "gpt-4o"
    max_tokens: int = 1000
    temperature: float = 0.7
    output_variable: str = "ai_response"

class WorkflowApproval(BaseModel):
    task_id: str
    step_id: str
    action: str
    comment: Optional[str] = None

class WorkflowStepUpdate(BaseModel):
    action: str
    comment: Optional[str] = None
    data: Optional[Dict[str, Any]] = Field(default_factory=dict)

class CommentCreate(BaseModel):
    text: str

# ==================== WORKFLOW ENGINE ====================

class EnterpriseWorkflowEngine:
    def __init__(self, database):
        self.db = database
    
    async def start_workflow(self, task_id: str, workflow_id: str, user_id: str, initial_variables: Dict[str, Any] = None):
        workflow = await self.db.workflows.find_one({"id": workflow_id}, {"_id": 0})
        if not workflow:
            raise HTTPException(status_code=404, detail="Workflow not found")
        
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
            "variables": {**workflow.get("variables", {}), **(initial_variables or {})}
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
        max_attempts = node.retry_policy.get("max_attempts", 3) if node.retry_policy else 3
        delay_seconds = node.retry_policy.get("delay_seconds", 60) if node.retry_policy else 60
        backoff = node.retry_policy.get("backoff", True) if node.retry_policy else True
        
        attempt = 1
        while attempt <= max_attempts:
            try:
                if node.type == "webhook_action":
                    result = await self._execute_webhook_action(node, workflow_variables)
                elif node.type == "ai_worker":
                    result = await self._execute_ai_worker(node, workflow_variables)
                else:
                    result = await self._execute_standard_node(node, workflow_variables)
                
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
                    "attempt": attempt,
                    "error": error_msg
                })
                
                if attempt >= max_attempts:
                    if node.on_error_next_node:
                        await log_audit(user_id, "NODE_ERROR_ROUTE", f"task-{task_id}", {
                            "from_node": node.id,
                            "to_node": node.on_error_next_node
                        })
                        return {"success": False, "error_route": node.on_error_next_node, "error": error_msg}
                    else:
                        await self.db.tasks.update_one(
                            {"id": task_id},
                            {"$set": {"status": "suspended", "updated_at": datetime.now(timezone.utc).isoformat()}}
                        )
                        await log_audit(user_id, "WORKFLOW_SUSPENDED", f"task-{task_id}", {"reason": error_msg})
                        raise HTTPException(status_code=500, detail=f"Workflow suspended due to: {error_msg}")
                
                import asyncio
                wait_time = delay_seconds * (2 ** (attempt - 1) if backoff else 1)
                await asyncio.sleep(wait_time)
                attempt += 1
    
    async def _execute_webhook_action(self, node: WorkflowNode, variables: Dict[str, Any]):
        import httpx
        from jinja2 import Template
        webhook_config = WebhookActionNode(**node.data)
        template = Template(webhook_config.body_template)
        body = template.render(**variables)
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
            return {"success": True, "response_status": response.status_code, "response_body": response.text[:1000]}
    
    async def _execute_ai_worker(self, node: WorkflowNode, variables: Dict[str, Any]):
        from jinja2 import Template
        ai_config = AIWorkerNode(**node.data)
        system_prompt = Template(ai_config.system_prompt).render(**variables)
        user_prompt = Template(ai_config.user_prompt).render(**variables)
        
        chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"ai-worker-{node.id}", system_message=system_prompt).with_model("openai", "gpt-4o")
        response = await chat.send_message(UserMessage(text=user_prompt))
        return {"success": True, "variables_update": {ai_config.output_variable: response}}
    
    async def _execute_standard_node(self, node: WorkflowNode, variables: Dict[str, Any]):
        return {"success": True}

    async def progress_workflow(self, task_id: str, user_id: str, comment: Optional[str] = None, data: Optional[Dict[str, Any]] = None):
        task = await self.db.tasks.find_one({"id": task_id}, {"_id": 0})
        if not task: raise HTTPException(status_code=404, detail="Task not found")
        
        workflow_state = task.get("workflow_state")
        if not workflow_state or not workflow_state.get("current_step"): raise HTTPException(status_code=400, detail="No active workflow")
        
        current_step_id = workflow_state["current_step"]
        workflow = await self.db.workflows.find_one({"id": task.get("workflow_id")}, {"_id": 0})
        
        current_node = next((n for n in workflow["nodes"] if n["id"] == current_step_id), None)
        
        workflow_state["completed_steps"].append({
            "step_id": current_step_id,
            "step_name": current_node["label"] if current_node else "Unknown",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "completed_by": user_id,
            "comment": comment,
            "data": data or {}
        })

        if data:
            current_metadata = task.get("metadata", {})
            updated_metadata = {**current_metadata, **data}
            await self.db.tasks.update_one(
                {"id": task_id},
                {"$set": {"metadata": updated_metadata}}
            )

        edges = workflow.get("edges", [])
        next_step_id = None
        for edge in edges:
            if edge["source"] == current_step_id:
                next_step_id = edge["target"]
                break
        
        if not next_step_id:
            await self.db.tasks.update_one({"id": task_id}, {"$set": {
                "status": "completed",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "workflow_state.current_step": None,
                "workflow_state.completed_steps": workflow_state["completed_steps"]
            }})
            await log_audit(user_id, "WORKFLOW_COMPLETE", f"task-{task_id}", {})
            return {"status": "completed"}
        
        next_node = next((n for n in workflow.get("nodes", []) if n["id"] == next_step_id), None)
        
        if next_node and next_node["type"] == "approval":
            approval = {
                "step_id": next_node["id"],
                "step_name": next_node["label"],
                "assigned_to": user_id,
                "requested_at": datetime.now(timezone.utc).isoformat()
            }
            await self.db.tasks.update_one({"id": task_id}, {
                "$set": {
                    "workflow_state.current_step": next_step_id,
                    "workflow_state.completed_steps": workflow_state["completed_steps"]
                },
                "$push": {
                    "workflow_state.pending_approvals": approval,
                    "workflow_state.step_history": {
                        "step_id": next_step_id,
                        "step_name": next_node["label"],
                        "status": "pending_approval",
                        "started_at": datetime.now(timezone.utc).isoformat()
                    }
                }
            })
        else:
            await self.db.tasks.update_one({"id": task_id}, {
                "$set": {
                    "workflow_state.current_step": next_step_id,
                    "workflow_state.completed_steps": workflow_state["completed_steps"]
                },
                "$push": {
                    "workflow_state.step_history": {
                        "step_id": next_step_id,
                        "step_name": next_node["label"] if next_node else "Unknown",
                        "status": "started",
                        "started_at": datetime.now(timezone.utc).isoformat(),
                        "started_by": user_id,
                        "comment": comment
                    }
                }
            })
        
        updated_task = await self.db.tasks.find_one({"id": task_id}, {"_id": 0})
        await log_audit(user_id, "WORKFLOW_PROGRESS", f"task-{task_id}", {"to_step": next_step_id})
        return updated_task.get("workflow_state")
    
    async def approve_step(self, task_id: str, step_id: str, user_id: str, action: str, comment: Optional[str] = None):
        task = await self.db.tasks.find_one({"id": task_id}, {"_id": 0})
        if not task: raise HTTPException(status_code=404, detail="Task not found")
        
        workflow_state = task.get("workflow_state")
        pending_approvals = workflow_state.get("pending_approvals", [])
        approval = next((a for a in pending_approvals if a["step_id"] == step_id and a["assigned_to"] == user_id), None)
        
        if not approval: raise HTTPException(status_code=404, detail="Approval not found")
        
        await self.db.tasks.update_one({"id": task_id}, {
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
        })
        
        if action == "approve":
            await self.progress_workflow(task_id, user_id, f"Approved: {comment or ''}")
        
        updated_task = await self.db.tasks.find_one({"id": task_id}, {"_id": 0})
        await log_audit(user_id, "WORKFLOW_APPROVAL", f"task-{task_id}", {"action": action, "step_id": step_id})
        return updated_task.get("workflow_state")
    
    async def rewind_workflow(self, task_id: str, target_step_id: str, user_id: str, reason: str):
        task = await self.db.tasks.find_one({"id": task_id}, {"_id": 0})
        if not task: raise HTTPException(status_code=404, detail="Task not found")
        
        workflow_state = task.get("workflow_state")
        step_history = workflow_state.get("step_history", [])
        target_step = next((s for s in step_history if s["step_id"] == target_step_id), None)
        
        if not target_step: raise HTTPException(status_code=404, detail="Target step not found in history")
        
        await self.db.tasks.update_one({"id": task_id}, {
            "$set": {"workflow_state.current_step": target_step_id, "status": "in_progress"},
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
        })
        
        await log_audit(user_id, "WORKFLOW_REWIND", f"task-{task_id}", {"reason": reason})
        updated_task = await self.db.tasks.find_one({"id": task_id}, {"_id": 0})
        return updated_task.get("workflow_state")

workflow_engine = None
if not workflow_engine:
    workflow_engine = EnterpriseWorkflowEngine(db)

# ==================== AUTH ENDPOINTS ====================

@api_router.post("/auth/register", response_model=User, status_code=201)
async def register(user_data: UserCreate):
    existing = await db.users.find_one({"email": user_data.email})
    if existing: raise HTTPException(status_code=409, detail="Email already registered")
    
    user = User(email=user_data.email, full_name=user_data.full_name, role="user", organization_id=user_data.organization_id)
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
    await db.users.update_one({"id": user_doc["id"]}, {"$set": {"last_login": datetime.now(timezone.utc).isoformat()}})
    
    user = User(**user_doc)
    return {"access_token": token, "token_type": "bearer", "user": user}

# ==================== PASSWORD MANAGEMENT ====================
class PasswordChange(BaseModel):
    new_password: str = Field(min_length=8)

@api_router.post("/auth/change-password")
async def change_password(data: PasswordChange, current_user: User = Depends(get_current_user)):
    new_hash = hash_password(data.new_password)
    await db.users.update_one({"id": current_user.id}, {
        "$set": {"password_hash": new_hash, "must_change_password": False, "updated_at": datetime.now(timezone.utc).isoformat()}
    })
    return {"status": "success", "message": "Password updated successfully"}

@api_router.get("/auth/me", response_model=User)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user

# ==================== ENDPOINTS (Tasks, Webhooks, etc) ====================

@api_router.get("/tasks")
async def get_tasks(status: Optional[str] = None, priority: Optional[str] = None, assignee_id: Optional[str] = None, limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), current_user: User = Depends(get_current_user)):
    query = {"organization_id": current_user.organization_id}
    if status: query["status"] = status
    if priority: query["priority"] = priority
    if assignee_id: query["assignee_id"] = assignee_id
    
    if current_user.role not in ["super_admin", "admin"]:
        # ✅ STRICT GROUP FILTERING APPLIED HERE
        or_conditions = [
            {"assignee_id": current_user.id},          # 1. Assigned to me
            {"creator_id": current_user.id}            # 2. Created by me
        ]
        
        # 3. Group tasks ONLY if they match my group
        if current_user.user_group:
            or_conditions.append({
                "assignee_id": None, 
                "assignee_group": current_user.user_group
            })
            
        query["$or"] = or_conditions
    
    total = await db.tasks.count_documents(query)
    tasks = await db.tasks.find(query, {"_id": 0}).skip(offset).limit(limit).to_list(limit)
    for task in tasks:
        if task.get("assignee_id"):
            assignee = await db.users.find_one({"id": task["assignee_id"]}, {"_id": 0, "id": 1, "full_name": 1})
            task["assignee"] = assignee
    return {"tasks": tasks, "total": total, "limit": limit, "offset": offset}

@api_router.post("/tasks", response_model=Task, status_code=201)
async def create_task(task_data: TaskCreate, current_user: User = Depends(get_current_user)):
    task = Task(**task_data.model_dump(), creator_id=current_user.id, organization_id=current_user.organization_id)
    await db.tasks.insert_one(task.model_dump())
    await log_audit(current_user.id, "TASK_CREATE", f"task-{task.id}", {"title": task.title})
    
    # Auto-start workflow if assigned
    if task.workflow_id:
        global workflow_engine
        if not workflow_engine:
            workflow_engine = EnterpriseWorkflowEngine(db)
        try:
            # ✅ FIX: Pass task.metadata as initial_variables so global fields are saved to the workflow context
            await workflow_engine.start_workflow(
                task.id, 
                task.workflow_id, 
                current_user.id, 
                initial_variables=task.metadata
            )
        except Exception as e:
            logger.warning(f"Failed to start workflow for task {task.id}: {str(e)}")
    
    return task

@api_router.get("/tasks/{task_id}", response_model=Task)
async def get_task(task_id: str, current_user: User = Depends(get_current_user)):
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not task: raise HTTPException(status_code=404, detail="Task not found")
    
    if current_user.role not in ["super_admin", "admin"]:
        if task.get("assignee_id") != current_user.id and task.get("creator_id") != current_user.id:
            # Allow if group matches
            if task.get("assignee_group") != current_user.user_group:
                raise HTTPException(status_code=403, detail="Access denied")
    return Task(**task)

@api_router.put("/tasks/{task_id}", response_model=Task)
async def update_task(task_id: str, task_update: TaskUpdate, current_user: User = Depends(get_current_user)):
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    update_data = {k: v for k, v in task_update.model_dump().items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    # Auto-set completed_at
    if update_data.get("status") == "completed" and task.get("status") != "completed":
        update_data["completed_at"] = datetime.now(timezone.utc).isoformat()
    
    await db.tasks.update_one({"id": task_id}, {"$set": update_data})
    await log_audit(current_user.id, "TASK_UPDATE", f"task-{task_id}", update_data)
    
    updated_task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    return Task(**updated_task)

@api_router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(task_id: str, current_user: User = Depends(require_role(["admin", "super_admin"]))):
    await db.tasks.delete_one({"id": task_id})
    await log_audit(current_user.id, "TASK_DELETE", f"task-{task_id}", {})
    return None

@api_router.post("/tasks/import")
async def import_tasks(file: UploadFile = File(...), dry_run: bool = Query(True), current_user: User = Depends(require_role(["admin", "super_admin"]))):
    if not file.filename.endswith(('.csv', '.xlsx')): raise HTTPException(status_code=400, detail="Only CSV/XLSX")
    content = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(content)) if file.filename.endswith('.csv') else pd.read_excel(io.BytesIO(content))
    except Exception as e: raise HTTPException(status_code=400, detail=f"Parse error: {str(e)}")
    
    imported_count = 0
    if not dry_run:
        for _, row in df.iterrows():
            task = Task(
                title=str(row.get('Title')),
                priority=str(row.get('Priority', 'medium')).lower(),
                creator_id=current_user.id,
                organization_id=current_user.organization_id
            )
            await db.tasks.insert_one(task.model_dump())
            imported_count += 1
            
    return {"status": "completed", "imported_count": imported_count, "dry_run": dry_run}

@api_router.get("/workflows")
async def get_workflows(current_user: User = Depends(get_current_user)):
    query = {
        "$or": [
            {"organization_id": current_user.organization_id},
            {"is_template": True}
        ]
    }
    workflows = await db.workflows.find(query, {"_id": 0}).to_list(100)
    return {"workflows": workflows}

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

@api_router.delete("/workflows/{workflow_id}", status_code=204)
async def delete_workflow(
    workflow_id: str,
    current_user: User = Depends(require_role(["admin", "super_admin"]))
):
    """Delete a workflow (Admin only)"""
    workflow = await db.workflows.find_one({"id": workflow_id})
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    
    await db.workflows.delete_one({"id": workflow_id})
    await log_audit(current_user.id, "WORKFLOW_DELETE", f"workflow-{workflow_id}", {"name": workflow.get("name")})
    return None

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
        # ✅ UPDATE: Pass the whole data object
        workflow_state = await workflow_engine.progress_workflow(
            task_id, current_user.id, request.comment, request.data
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
    # 1. Base Scope
    query = {"organization_id": current_user.organization_id}
    
    # 2. Role Restriction
    if current_user.role not in ["super_admin", "admin"]:
        query["$or"] = [{"assignee_id": current_user.id}, {"creator_id": current_user.id}]
    
    # 3. Calculate Basic Counts
    total_tasks = await db.tasks.count_documents(query)
    
    completed_query = {**query, "status": "completed"}
    completed_tasks = await db.tasks.count_documents(completed_query)
    
    pending_query = {**query, "status": {"$in": ["new", "in_progress"]}}
    pending_tasks = await db.tasks.count_documents(pending_query)
    
    # 4. Calculate Overdue (Missing in your current code)
    now = datetime.now(timezone.utc).isoformat()
    overdue_query = {**query, "status": {"$ne": "completed"}, "due_date": {"$lt": now}}
    overdue_tasks = await db.tasks.count_documents(overdue_query)
    
    # 5. Calculate Rates (Missing in your current code)
    completion_rate = (completed_tasks / total_tasks * 100) if total_tasks > 0 else 0
    
    return {
        "period": period,
        "metrics": {
            "total_tasks": total_tasks,
            "completed_tasks": completed_tasks,
            "pending_tasks": pending_tasks,
            "overdue_tasks": overdue_tasks,
            "completion_rate": round(completion_rate, 2),
            "avg_completion_time_hours": 24.5 # Placeholder for now
        },
        "sla_breaches": overdue_tasks
    }

# ==================== USER & ROLE MANAGEMENT ====================

@api_router.get("/users")
async def get_users(current_user: User = Depends(require_role(["admin", "super_admin"]))):
    query = {"organization_id": current_user.organization_id}
    users = await db.users.find(query, {"_id": 0, "password_hash": 0}).to_list(100)
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

@api_router.delete("/users/{user_id}", status_code=204)
async def delete_user(user_id: str, current_user: User = Depends(require_super_admin)):
    if user_id == current_user.id:
        raise HTTPException(status_code=403, detail="Cannot delete self")
    result = await db.users.delete_one({"id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    await log_audit(current_user.id, "USER_DELETE", f"user-{user_id}", {})
    return None

@api_router.get("/organization/groups")
async def get_organization_groups(current_user: User = Depends(get_current_user)):
    """Get all distinct user groups for the current organization"""
    groups = await db.users.distinct("user_group", {"organization_id": current_user.organization_id})
    # Filter out None/Null and sort
    clean_groups = sorted([g for g in groups if g])
    return {"groups": clean_groups}

# ==================== AUDIT LOGS ====================

@api_router.get("/audit-logs")
async def get_audit_logs(
    actor_id: Optional[str] = None,
    action: Optional[str] = None,
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(require_role(["admin", "super_admin"]))
):
    query = {}
    # Enforce Organization Scope
    org_users = await db.users.find(
        {"organization_id": current_user.organization_id}, 
        {"id": 1}
    ).to_list(1000)
    org_user_ids = [u["id"] for u in org_users] + ["system"]
    query["actor_id"] = {"$in": org_user_ids}

    if actor_id: query["actor_id"] = actor_id
    if action: query["action"] = action
    
    logs = await db.audit_logs.find(query, {"_id": 0}).sort("timestamp", -1).limit(limit).to_list(limit)
    total = await db.audit_logs.count_documents(query)
    
    return {"logs": logs, "total": total}

@api_router.post("/admin/onboard-tenant", status_code=201)
async def onboard_tenant(
    data: TenantOnboard, 
    current_user: User = Depends(require_role(["super_admin"]))
):
    if await db.users.find_one({"email": data.admin_email}):
        raise HTTPException(status_code=400, detail="Email exists")
    
    new_org = Organization(name=data.company_name)
    await db.organizations.insert_one(new_org.model_dump())
    
    temp_password = f"Welcome{uuid.uuid4().hex[:4].upper()}!"
    new_user = User(
        email=data.admin_email, full_name=data.admin_name, role="admin",
        organization_id=new_org.id, is_active=True, must_change_password=True
    )
    user_doc = new_user.model_dump()
    user_doc["password_hash"] = hash_password(temp_password)
    await db.users.insert_one(user_doc)
    
    return {"status": "success", "admin_user": {"email": data.admin_email, "temp_password": temp_password}}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}

# Include router
app.include_router(api_router)

# Register the new Organization Router
from organization_endpoints import router as organization_router
app.include_router(organization_router, prefix="/api")

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
    if client: client.close()

# ==================== DATABASE SEEDING ====================
@app.on_event("startup")
async def seed_database():
    try:
        existing_admin = await db.users.find_one({"email": "admin@katalusis.com"})
        if existing_admin: return
        
        default_org = Organization(name="Katalusis Demo Organization", subdomain="demo")
        await db.organizations.insert_one(default_org.model_dump())
        
        admin = User(
            email="admin@katalusis.com", full_name="Super Admin", role="super_admin", organization_id=default_org.id
        )
        admin_doc = admin.model_dump()
        admin_doc["password_hash"] = hash_password("Admin@123")
        
        await db.users.insert_one(admin_doc)
    except Exception as e:
        logger.error(f"Database seeding error: {str(e)}")

# Serve React frontend
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
static_dir = Path(__file__).parent / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir / "static")), name="static")
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = static_dir / full_path
        if file_path.is_file(): return FileResponse(file_path)
        index_path = static_dir / "index.html"
        if index_path.exists(): return FileResponse(index_path)
        raise HTTPException(status_code=404, detail="Not found")

logger.info("✅ Katalusis Workflow OS Enterprise API initialized successfully!")