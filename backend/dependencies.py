from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from motor.motor_asyncio import AsyncIOMotorClient
from jose import jwt, JWTError
from typing import List, Optional
import os
import bcrypt
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel, Field, ConfigDict
import uuid

# Initialize security
security = HTTPBearer()

# Environment variables
JWT_SECRET = os.environ.get('JWT_SECRET', 'default_secret')
JWT_ALGORITHM = os.environ.get('JWT_ALGORITHM', 'HS256')
JWT_EXPIRATION_HOURS = int(os.environ.get('JWT_EXPIRATION_HOURS', '24'))

# Database connection (will be set by main app)
db = None

def set_database(database):
    """Set the database connection from main app"""
    global db
    db = database

# ==================== MODELS ====================

class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email: str
    full_name: str
    role: str = "user"
    user_group: Optional[str] = None
    is_active: bool = True
    must_change_password: bool = False
    organization_id: Optional[str] = None
    external_id: Optional[str] = None
    avatar_url: Optional[str] = None
    preferences: dict = Field(default_factory=lambda: {"theme": "light", "default_view": "kanban"})
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class AuditLog(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    actor_id: str
    action: str  # e.g., "TASK_UPDATE", "WORKFLOW_MODIFICATION"
    target_resource: str  # e.g., "Task-101"
    changes: dict = Field(default_factory=dict)  # Old Value vs New Value diff
    metadata: dict = Field(default_factory=dict)  # Additional context
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None

# ==================== AUTHENTICATION FUNCTIONS ====================

def hash_password(password: str) -> str:
    """Hash password using bcrypt"""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    """Verify password against hash"""
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_jwt_token(user_id: str, email: str, role: str) -> str:
    """Create JWT access token"""
    expiration = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    payload = {
        "user_id": user_id,
        "email": email,
        "role": role,
        "exp": expiration
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> User:
    """Get current authenticated user"""
    try:
        token = credentials.credentials
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("user_id")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token"
            )
        
        user_doc = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not user_doc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found"
            )
        
        return User(**user_doc)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )

def require_role(allowed_roles: List[str]):
    """Dependency to require specific roles"""
    async def role_checker(current_user: User = Depends(get_current_user)):
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions"
            )
        return current_user
    return role_checker

def require_admin(current_user: User = Depends(get_current_user)):
    """Require admin or super_admin role"""
    if current_user.role not in ["admin", "super_admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return current_user

def require_super_admin(current_user: User = Depends(get_current_user)):
    """Require super_admin role"""
    if current_user.role != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin access required"
        )
    return current_user

# ==================== AUDIT LOGGING ====================

async def log_audit(actor_id: str, action: str, target_resource: str, changes: dict = None, metadata: dict = None):
    """Log audit trail for critical operations"""
    audit_log = AuditLog(
        actor_id=actor_id,
        action=action,
        target_resource=target_resource,
        changes=changes or {},
        metadata=metadata or {}
    )
    
    try:
        await db.audit_logs.insert_one(audit_log.model_dump())
    except Exception as e:
        # Log but don't fail the main operation
        import logging
        logging.error(f"Failed to write audit log: {str(e)}")

# ==================== MULTI-TENANT SUPPORT ====================

class Organization(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    subdomain: str
    is_active: bool = True
    settings: dict = Field(default_factory=dict)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

async def get_current_organization(current_user: User = Depends(get_current_user)) -> Optional[Organization]:
    """Get current user's organization for multi-tenant isolation"""
    if not current_user.organization_id:
        return None
        
    org_doc = await db.organizations.find_one(
        {"id": current_user.organization_id}, 
        {"_id": 0}
    )
    
    if not org_doc or not org_doc.get("is_active"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization not found or inactive"
        )
    
    return Organization(**org_doc)
