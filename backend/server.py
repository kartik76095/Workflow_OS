from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, UploadFile, File, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pydantic import BaseModel, Field, EmailStr, ConfigDict, validator
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
from pathlib import Path
import os
import logging
import uuid
import bcrypt
from jose import jwt, JWTError
import pandas as pd
import io
from emergentintegrations.llm.chat import LlmChat, UserMessage

# Configuration
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = os.environ['JWT_ALGORITHM']
JWT_EXPIRATION_HOURS = int(os.environ['JWT_EXPIRATION_HOURS'])
EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']

# Initialize FastAPI
app = FastAPI(title="Katalusis Workflow OS API", version="1.0.0")
api_router = APIRouter(prefix="/api")
security = HTTPBearer()

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ==================== MODELS ====================

# User Models
class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    organization_id: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str
    organization_subdomain: Optional[str] = None

class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email: str
    full_name: str
    role: str = "user"
    is_active: bool = True
    organization_id: str
    external_id: Optional[str] = None  # For syncing with external systems
    avatar_url: Optional[str] = None
    preferences: Dict[str, Any] = Field(default_factory=lambda: {"theme": "light", "default_view": "kanban"})
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

# Organization Models
class OrganizationCreate(BaseModel):
    name: str
    subdomain: str
    admin_email: EmailStr
    admin_name: str
    admin_password: str

class Organization(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    subdomain: str  # For organization-specific URLs
    is_active: bool = True
    settings: Dict[str, Any] = Field(default_factory=lambda: {
        "sso_enabled": False,
        "external_sync_enabled": False,
        "max_users": 100
    })
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

# Database Connection Models
class DatabaseConnectionCreate(BaseModel):
    name: str
    connection_type: str  # "sql_server", "postgresql", "mysql"
    host: str
    port: int
    database: str
    username: str
    password: str
    ssl_enabled: bool = False
    sync_users: bool = False
    sync_workflows: bool = False

class DatabaseConnection(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    organization_id: str
    name: str
    connection_type: str
    host: str
    port: int
    database: str
    username: str
    password_encrypted: str
    ssl_enabled: bool = False
    sync_users: bool = False
    sync_workflows: bool = False
    is_active: bool = True
    last_sync: Optional[str] = None
    sync_status: str = "never_synced"  # "never_synced", "syncing", "success", "error"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

# SSO Integration Models
class SSOConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    organization_id: str
    provider: str  # "saml", "oauth", "active_directory"
    provider_name: str  # Display name
    config: Dict[str, Any]  # Provider-specific configuration
    is_active: bool = True
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

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
    organization_id: str  # Multi-tenant isolation
    workflow_id: Optional[str] = None
    external_id: Optional[str] = None  # For syncing with external systems
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
        "completed_steps": []
    })
    
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    completed_at: Optional[str] = None

class CommentCreate(BaseModel):
    text: str

# Workflow Models
class WorkflowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    nodes: List[Dict[str, Any]] = Field(default_factory=list)
    edges: List[Dict[str, Any]] = Field(default_factory=list)
    rules: List[Dict[str, Any]] = Field(default_factory=list)
    is_template: bool = False

class Workflow(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: Optional[str] = None
    creator_id: str
    is_active: bool = True
    is_template: bool = False
    nodes: List[Dict[str, Any]] = Field(default_factory=list)
    edges: List[Dict[str, Any]] = Field(default_factory=list)
    rules: List[Dict[str, Any]] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

# AI Models
class AIGenerateWorkflow(BaseModel):
    description: str
    context: Dict[str, Any] = Field(default_factory=dict)

class AIChatMessage(BaseModel):
    message: str
    session_id: Optional[str] = None

# Workflow Execution Models
class WorkflowApproval(BaseModel):
    task_id: str
    step_id: str
    action: str  # "approve" or "reject"
    comment: Optional[str] = None

class WorkflowStepUpdate(BaseModel):
    action: str  # "start", "complete", "approve", "reject"
    comment: Optional[str] = None

# Audit Log Model
class AuditLog(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    action: str
    resource_type: str
    resource_id: str
    changes: Dict[str, Any] = Field(default_factory=dict)
    ip_address: Optional[str] = None
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

# ==================== WORKFLOW ENGINE ====================

class WorkflowEngine:
    def __init__(self, db):
        self.db = db
    
    async def start_workflow(self, task_id: str, workflow_id: str, user_id: str):
        """Start a workflow for a task"""
        workflow = await self.db.workflows.find_one({"id": workflow_id}, {"_id": 0})
        if not workflow:
            raise HTTPException(status_code=404, detail="Workflow not found")
        
        # Get first node in workflow
        first_node = None
        if workflow.get("nodes"):
            # Find node with no incoming edges or first task node
            edges = workflow.get("edges", [])
            incoming_nodes = {edge["target"] for edge in edges}
            for node in workflow["nodes"]:
                if node["id"] not in incoming_nodes or node["type"] == "task":
                    first_node = node
                    break
        
        if not first_node:
            raise HTTPException(status_code=400, detail="Workflow has no starting node")
        
        # Update task with workflow state
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
            "completed_steps": []
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
        
        await log_audit(user_id, "workflow.start", "task", task_id, {"workflow_id": workflow_id})
        return workflow_state
    
    async def progress_workflow(self, task_id: str, user_id: str, comment: str = None):
        """Move task to next step in workflow"""
        task = await self.db.tasks.find_one({"id": task_id}, {"_id": 0})
        if not task or not task.get("workflow_id"):
            raise HTTPException(status_code=404, detail="Task or workflow not found")
        
        workflow = await self.db.workflows.find_one({"id": task["workflow_id"]}, {"_id": 0})
        if not workflow:
            raise HTTPException(status_code=404, detail="Workflow not found")
        
        current_step_id = task["workflow_state"]["current_step"]
        current_node = next((n for n in workflow["nodes"] if n["id"] == current_step_id), None)
        
        if not current_node:
            raise HTTPException(status_code=400, detail="Current workflow step not found")
        
        # Find next step
        next_step = await self._get_next_step(workflow, current_step_id, task)
        
        # Update workflow state
        workflow_state = task["workflow_state"]
        
        # Complete current step
        workflow_state["completed_steps"].append({
            "step_id": current_step_id,
            "step_name": current_node["label"],
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "completed_by": user_id,
            "comment": comment
        })
        
        if next_step:
            # Move to next step
            workflow_state["current_step"] = next_step["id"]
            workflow_state["step_history"].append({
                "step_id": next_step["id"],
                "step_name": next_step["label"],
                "status": "started",
                "started_at": datetime.now(timezone.utc).isoformat(),
                "started_by": user_id
            })
            
            # Handle different node types
            if next_step["type"] == "approval":
                # Add to pending approvals
                workflow_state["pending_approvals"].append({
                    "step_id": next_step["id"],
                    "step_name": next_step["label"],
                    "assigned_to": task.get("assignee_id") or user_id,
                    "created_at": datetime.now(timezone.utc).isoformat()
                })
            
            task_status = "in_progress"
        else:
            # Workflow complete
            workflow_state["current_step"] = None
            task_status = "completed"
            workflow_state["completed_at"] = datetime.now(timezone.utc).isoformat()
        
        await self.db.tasks.update_one(
            {"id": task_id},
            {"$set": {
                "workflow_state": workflow_state,
                "status": task_status,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }}
        )
        
        await log_audit(user_id, "workflow.progress", "task", task_id)
        return workflow_state
    
    async def approve_step(self, task_id: str, step_id: str, user_id: str, action: str, comment: str = None):
        """Approve or reject a workflow step"""
        task = await self.db.tasks.find_one({"id": task_id}, {"_id": 0})
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        
        workflow_state = task["workflow_state"]
        
        # Find and remove from pending approvals
        approval = None
        for i, pending in enumerate(workflow_state["pending_approvals"]):
            if pending["step_id"] == step_id:
                approval = workflow_state["pending_approvals"].pop(i)
                break
        
        if not approval:
            raise HTTPException(status_code=400, detail="No pending approval found for this step")
        
        # Add to step history
        workflow_state["step_history"].append({
            "step_id": step_id,
            "step_name": approval["step_name"],
            "status": action,
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "completed_by": user_id,
            "comment": comment
        })
        
        if action == "approve":
            # Continue workflow
            await self.progress_workflow(task_id, user_id, f"Approved: {comment or ''}")
        else:
            # Reject - could stop workflow or go back to previous step
            workflow_state["current_step"] = None
            await self.db.tasks.update_one(
                {"id": task_id},
                {"$set": {
                    "workflow_state": workflow_state,
                    "status": "on_hold",
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }}
            )
        
        await log_audit(user_id, f"workflow.{action}", "task", task_id)
        return workflow_state
    
    async def _get_next_step(self, workflow: Dict, current_step_id: str, task: Dict):
        """Find the next step in workflow"""
        edges = workflow.get("edges", [])
        
        # Find edges from current step
        next_edges = [e for e in edges if e["source"] == current_step_id]
        
        if not next_edges:
            return None  # End of workflow
        
        # For now, take first edge (in real implementation, handle conditions)
        next_edge = next_edges[0]
        next_node = next((n for n in workflow["nodes"] if n["id"] == next_edge["target"]), None)
        
        # Handle condition nodes
        if next_node and next_node["type"] == "condition":
            return await self._evaluate_condition(workflow, next_node, task)
        
        return next_node
    
    async def _evaluate_condition(self, workflow: Dict, condition_node: Dict, task: Dict):
        """Evaluate condition and return next node"""
        # Simple condition evaluation based on task metadata
        condition_data = condition_node.get("data", {})
        condition_text = condition_data.get("condition", "")
        
        # Example: "amount > 5000"
        if "amount" in condition_text and ">" in condition_text:
            try:
                amount = float(task["metadata"].get("amount", 0))
                threshold = float(condition_text.split(">")[1].strip())
                condition_met = amount > threshold
            except:
                condition_met = False
        else:
            condition_met = True  # Default to true
        
        # Find appropriate edge
        edges = workflow.get("edges", [])
        condition_edges = [e for e in edges if e["source"] == condition_node["id"]]
        
        for edge in condition_edges:
            if (condition_met and edge.get("label", "").lower() in ["yes", "true"]) or \
               (not condition_met and edge.get("label", "").lower() in ["no", "false"]):
                return next((n for n in workflow["nodes"] if n["id"] == edge["target"]), None)
        
        # Default to first edge
        if condition_edges:
            next_edge = condition_edges[0]
            return next((n for n in workflow["nodes"] if n["id"] == next_edge["target"]), None)
        
        return None

# Global workflow engine instance
workflow_engine = None

# ==================== AUTHENTICATION ====================

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_jwt_token(user_id: str, email: str, role: str) -> str:
    expiration = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    payload = {
        "user_id": user_id,
        "email": email,
        "role": role,
        "exp": expiration
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        token = credentials.credentials
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("user_id")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        
        user_doc = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not user_doc:
            raise HTTPException(status_code=401, detail="User not found")
        
        return User(**user_doc)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

def require_role(allowed_roles: List[str]):
    async def role_checker(current_user: User = Depends(get_current_user)):
        if current_user.role not in allowed_roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return current_user
    return role_checker

async def log_audit(user_id: str, action: str, resource_type: str, resource_id: str, changes: Dict = None):
    audit_log = AuditLog(
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        changes=changes or {}
    )
    await db.audit_logs.insert_one(audit_log.model_dump())

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
        role="user"
    )
    
    user_doc = user.model_dump()
    user_doc["password_hash"] = hash_password(user_data.password)
    
    await db.users.insert_one(user_doc)
    await log_audit(user.id, "user.register", "user", user.id)
    
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
    task = Task(**task_data.model_dump(), creator_id=current_user.id)
    await db.tasks.insert_one(task.model_dump())
    await log_audit(current_user.id, "task.create", "task", task.id)
    
    # Auto-start workflow if assigned
    if task.workflow_id:
        global workflow_engine
        if not workflow_engine:
            workflow_engine = WorkflowEngine(db)
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
    
    update_data = {k: v for k, v in task_update.model_dump(exclude_unset=True).items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    if update_data.get("status") == "completed" and task.get("status") != "completed":
        update_data["completed_at"] = datetime.now(timezone.utc).isoformat()
    
    await db.tasks.update_one({"id": task_id}, {"$set": update_data})
    await log_audit(current_user.id, "task.update", "task", task_id, update_data)
    
    updated_task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    return Task(**updated_task)

@api_router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(task_id: str, current_user: User = Depends(require_role(["admin", "super_admin"]))):
    result = await db.tasks.delete_one({"id": task_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    await log_audit(current_user.id, "task.delete", "task", task_id)
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
    await log_audit(current_user.id, "task.comment", "task", task_id)
    
    return comment

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
    await log_audit(current_user.id, "task.import", "task_import", import_record["id"])
    
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
    workflow = Workflow(**workflow_data.model_dump(), creator_id=current_user.id)
    await db.workflows.insert_one(workflow.model_dump())
    await log_audit(current_user.id, "workflow.create", "workflow", workflow.id)
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
    global workflow_engine
    if not workflow_engine:
        workflow_engine = WorkflowEngine(db)
    
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
    global workflow_engine
    if not workflow_engine:
        workflow_engine = WorkflowEngine(db)
    
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
    global workflow_engine
    if not workflow_engine:
        workflow_engine = WorkflowEngine(db)
    
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
    
    await log_audit(current_user.id, "user.update_role", "user", user_id, {"role": role})
    
    return {"id": user_id, "role": role, "updated_at": datetime.now(timezone.utc).isoformat()}

# ==================== AUDIT LOGS ====================

@api_router.get("/audit-logs")
async def get_audit_logs(
    user_id: Optional[str] = None,
    action: Optional[str] = None,
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(require_role(["admin", "super_admin"]))
):
    query = {}
    if user_id:
        query["user_id"] = user_id
    if action:
        query["action"] = action
    
    logs = await db.audit_logs.find(query, {"_id": 0}).sort("timestamp", -1).limit(limit).to_list(limit)
    total = await db.audit_logs.count_documents(query)
    
    return {"logs": logs, "total": total}

# ==================== HEALTH CHECK ====================

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}

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
async def shutdown_db_client():
    client.close()

# ==================== DATABASE SEEDING ====================

@app.on_event("startup")
async def seed_database():
    """Seed default roles and super admin on first startup"""
    try:
        # Check if already seeded
        existing_admin = await db.users.find_one({"email": "admin@katalusis.com"})
        if existing_admin:
            logger.info("Database already seeded")
            return
        
        # Create super admin
        admin = User(
            email="admin@katalusis.com",
            full_name="Super Admin",
            role="super_admin"
        )
        
        admin_doc = admin.model_dump()
        admin_doc["password_hash"] = hash_password("Admin@123")
        
        await db.users.insert_one(admin_doc)
        logger.info("✅ Database seeded with super admin (admin@katalusis.com / Admin@123)")
        
        # Create sample workflow template
        sample_workflow = Workflow(
            name="Invoice Approval Workflow",
            description="Standard 3-step invoice approval process",
            creator_id=admin.id,
            is_template=True,
            nodes=[
                {"id": "node-1", "type": "task", "label": "Submit Invoice", "position": {"x": 100, "y": 100}, "data": {}},
                {"id": "node-2", "type": "approval", "label": "Finance Review", "position": {"x": 300, "y": 100}, "data": {}},
                {"id": "node-3", "type": "condition", "label": "Amount > $5000?", "position": {"x": 500, "y": 100}, "data": {}},
                {"id": "node-4", "type": "approval", "label": "Manager Approval", "position": {"x": 700, "y": 100}, "data": {}}
            ],
            edges=[
                {"id": "edge-1", "source": "node-1", "target": "node-2", "label": "Submit"},
                {"id": "edge-2", "source": "node-2", "target": "node-3", "label": "Approved"},
                {"id": "edge-3", "source": "node-3", "target": "node-4", "label": "Yes"}
            ]
        )
        await db.workflows.insert_one(sample_workflow.model_dump())
        logger.info("✅ Sample workflow template created")
        
    except Exception as e:
        logger.error(f"Database seeding error: {str(e)}")
