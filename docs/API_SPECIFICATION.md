# Katalusis Workflow OS - API Specification

## Base URL
```
Development: http://localhost:8001/api
Production: https://workflow-engine-28.preview.emergentagent.com/api
```

## Authentication
All endpoints (except `/auth/login` and `/auth/register`) require JWT token:

```
Authorization: Bearer <jwt_token>
```

---

## 1. Authentication Endpoints

### POST /auth/register
Register a new user account.

**Request**:
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "full_name": "John Doe"
}
```

**Response** (201):
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "full_name": "John Doe",
  "role": "user",
  "created_at": "2025-01-15T10:00:00Z"
}
```

### POST /auth/login
Authenticate and receive JWT token.

**Request**:
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response** (200):
```json
{
  "access_token": "eyJhbGc...",
  "token_type": "bearer",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "full_name": "John Doe",
    "role": "user"
  }
}
```

### GET /auth/me
Get current user profile.

**Response** (200):
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "full_name": "John Doe",
  "role": "user",
  "avatar_url": null,
  "preferences": {
    "theme": "light",
    "default_view": "kanban"
  }
}
```

---

## 2. Task Management Endpoints

### GET /tasks
List all tasks with optional filters.

**Query Parameters**:
- `status` (optional): Filter by status
- `priority` (optional): Filter by priority
- `assignee_id` (optional): Filter by assignee
- `view` (optional): kanban|list|timeline
- `limit` (default: 50)
- `offset` (default: 0)

**Response** (200):
```json
{
  "tasks": [
    {
      "id": "uuid",
      "title": "Invoice Approval #2198",
      "status": "new",
      "priority": "high",
      "assignee": {
        "id": "uuid",
        "full_name": "John Doe",
        "avatar_url": null
      },
      "due_date": "2025-10-25T23:59:59Z",
      "tags": ["finance", "invoice"],
      "created_at": "2025-01-15T10:00:00Z"
    }
  ],
  "total": 100,
  "limit": 50,
  "offset": 0
}
```

### POST /tasks
Create a new task.

**Request**:
```json
{
  "title": "Invoice Approval #2198",
  "description": "3-step approval process",
  "priority": "high",
  "assignee_id": "user-uuid",
  "due_date": "2025-10-25T23:59:59Z",
  "tags": ["finance", "invoice"],
  "metadata": {
    "invoice_number": "2198"
  }
}
```

**Response** (201):
```json
{
  "id": "uuid",
  "title": "Invoice Approval #2198",
  "status": "new",
  "priority": "high",
  "created_at": "2025-01-15T10:00:00Z"
}
```

### GET /tasks/{task_id}
Get task details.

**Response** (200):
```json
{
  "id": "uuid",
  "title": "Invoice Approval #2198",
  "description": "3-step approval process",
  "status": "new",
  "priority": "high",
  "assignee": {...},
  "comments": [...],
  "attachments": [...],
  "created_at": "2025-01-15T10:00:00Z"
}
```

### PATCH /tasks/{task_id}
Update task fields.

**Request**:
```json
{
  "status": "in_progress",
  "priority": "critical"
}
```

**Response** (200):
```json
{
  "id": "uuid",
  "status": "in_progress",
  "updated_at": "2025-01-15T11:00:00Z"
}
```

### DELETE /tasks/{task_id}
Delete a task (soft delete).

**Response** (204): No content

### POST /tasks/{task_id}/comments
Add a comment to a task.

**Request**:
```json
{
  "text": "Approved by finance team"
}
```

**Response** (201):
```json
{
  "id": "comment-uuid",
  "text": "Approved by finance team",
  "user": {...},
  "created_at": "2025-01-15T10:00:00Z"
}
```

---

## 3. Task Import Endpoints (CRITICAL MVP)

### POST /tasks/import
Bulk import tasks from CSV/Excel file.

**Request**: multipart/form-data
- `file`: CSV or XLSX file
- `dry_run` (optional): true|false (default: true)

**Response** (200):
```json
{
  "import_id": "uuid",
  "filename": "tasks_2025-01-15.csv",
  "status": "completed",
  "total_rows": 100,
  "imported_count": 97,
  "skipped_count": 3,
  "errors": [
    {
      "row": 5,
      "field": "due_date",
      "error": "Invalid date format",
      "value": "2025-13-01"
    }
  ],
  "report_url": "/api/imports/uuid/report"
}
```

### GET /imports/{import_id}/report
Download import error report as CSV.

**Response** (200): CSV file
```csv
Row,Field,Error,Value
5,due_date,Invalid date format,2025-13-01
12,priority,Invalid priority value,Urgent
```

### GET /imports/template
Download CSV template for task import.

**Response** (200): CSV file
```csv
Title,Description,AssigneeEmail,Priority,DueDate,Tags,Status
"Sample Task","Description here","user@example.com","Medium","2025-12-31","tag1,tag2","New"
```

---

## 4. Workflow Endpoints

### GET /workflows
List all workflows.

**Query Parameters**:
- `is_template` (optional): Filter templates
- `is_active` (optional): Filter active workflows

**Response** (200):
```json
{
  "workflows": [
    {
      "id": "uuid",
      "name": "Invoice Approval Process",
      "description": "Standard 3-step invoice approval",
      "is_active": true,
      "is_template": false,
      "created_at": "2025-01-15T10:00:00Z"
    }
  ],
  "total": 10
}
```

### POST /workflows
Create a new workflow.

**Request**:
```json
{
  "name": "Invoice Approval Process",
  "description": "Standard 3-step invoice approval",
  "nodes": [...],
  "edges": [...],
  "rules": [...]
}
```

**Response** (201):
```json
{
  "id": "uuid",
  "name": "Invoice Approval Process",
  "created_at": "2025-01-15T10:00:00Z"
}
```

### GET /workflows/{workflow_id}
Get workflow details.

**Response** (200):
```json
{
  "id": "uuid",
  "name": "Invoice Approval Process",
  "nodes": [...],
  "edges": [...],
  "rules": [...]
}
```

---

## 5. AI Assistant Endpoints

### POST /ai/generate-workflow
Generate workflow from natural language description.

**Request**:
```json
{
  "description": "Create a workflow for invoice approval that requires finance review, then manager approval if amount exceeds $5000",
  "context": {
    "user_role": "admin"
  }
}
```

**Response** (200):
```json
{
  "workflow": {
    "name": "Invoice Approval Process",
    "nodes": [
      {
        "id": "node-1",
        "type": "task",
        "label": "Finance Review"
      },
      {
        "id": "node-2",
        "type": "condition",
        "label": "Amount > $5000?"
      }
    ],
    "edges": [...]
  },
  "explanation": "I've created a 2-step workflow..."
}
```

### POST /ai/chat
Conversational AI assistant.

**Request**:
```json
{
  "message": "Summarize tasks due this week",
  "session_id": "session-uuid"
}
```

**Response** (200):
```json
{
  "response": "You have 15 tasks due this week. 5 are high priority...",
  "session_id": "session-uuid"
}
```

### POST /ai/suggest-rules
Get AI-powered rule recommendations.

**Request**:
```json
{
  "workflow_id": "workflow-uuid"
}
```

**Response** (200):
```json
{
  "suggestions": [
    {
      "rule": "Auto-escalate tasks overdue by 2+ days",
      "condition": "days_overdue > 2",
      "action": "escalate_to_manager",
      "confidence": 0.85
    }
  ]
}
```

---

## 6. Analytics Endpoints

### GET /analytics/dashboard
Get dashboard metrics.

**Query Parameters**:
- `period` (optional): today|week|month|year

**Response** (200):
```json
{
  "period": "week",
  "metrics": {
    "total_tasks": 150,
    "completed_tasks": 135,
    "pending_tasks": 15,
    "overdue_tasks": 3,
    "completion_rate": 90.0,
    "avg_completion_time_hours": 24.5
  },
  "top_performers": [
    {
      "user_id": "uuid",
      "full_name": "John Doe",
      "completed_tasks": 25
    }
  ],
  "sla_breaches": 3
}
```

---

## 7. User & Role Management

### GET /users
List all users (Admin only).

**Response** (200):
```json
{
  "users": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "full_name": "John Doe",
      "role": "user",
      "is_active": true
    }
  ]
}
```

### PATCH /users/{user_id}/role
Update user role (Super Admin only).

**Request**:
```json
{
  "role_id": "admin-role-uuid"
}
```

**Response** (200):
```json
{
  "id": "uuid",
  "role": "admin",
  "updated_at": "2025-01-15T10:00:00Z"
}
```

---

## 8. Audit Logs

### GET /audit-logs
Query audit logs (Admin only).

**Query Parameters**:
- `user_id` (optional)
- `action` (optional)
- `start_date` (optional)
- `end_date` (optional)
- `limit` (default: 50)

**Response** (200):
```json
{
  "logs": [
    {
      "id": "uuid",
      "user": {...},
      "action": "task.update",
      "resource_type": "task",
      "resource_id": "task-uuid",
      "changes": {...},
      "timestamp": "2025-01-15T10:00:00Z"
    }
  ],
  "total": 500
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired token",
    "details": {}
  }
}
```

**Common Error Codes**:
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `409` - Conflict (duplicate resource)
- `422` - Unprocessable Entity
- `500` - Internal Server Error

---

## Rate Limiting

- Authenticated endpoints: 1000 requests/hour/user
- AI endpoints: 100 requests/hour/user
- Import endpoints: 10 requests/hour/user

**Rate Limit Headers**:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 950
X-RateLimit-Reset: 1642258800
```
