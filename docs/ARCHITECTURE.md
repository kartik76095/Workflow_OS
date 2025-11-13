# Katalusis Workflow OS - System Architecture

## Overview
Katalusis is a no-code/low-code workflow management platform built with:
- **Frontend**: React 19 + TailwindCSS + Shadcn UI + Framer Motion
- **Backend**: FastAPI (Python)
- **Database**: MongoDB
- **AI**: OpenAI GPT-4o via Emergent LLM Key
- **Deployment**: Docker + Kubernetes

---

## Architecture Layers

```
┌─────────────────────────────────────────────────┐
│            CLIENT LAYER (Browser)               │
│  React SPA + TailwindCSS + Framer Motion       │
└─────────────────┬───────────────────────────────┘
                  │ HTTPS/WSS
┌─────────────────▼───────────────────────────────┐
│          API GATEWAY / INGRESS                  │
│    (Kubernetes Ingress - /api/* routing)       │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│         BACKEND LAYER (FastAPI)                 │
├─────────────────────────────────────────────────┤
│  • Auth & RBAC Module                          │
│  • Task Management Module                      │
│  • Workflow Builder Module                     │
│  • Excel/CSV Import Module (CRITICAL)          │
│  • Database Connector Module                   │
│  • AI Assistant Module                         │
│  • Analytics Module                            │
│  • Audit Log Module                            │
└─────────────────┬───────────────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
┌───▼───┐   ┌─────▼─────┐  ┌───▼────┐
│MongoDB│   │AI Service │  │External│
│  Core │   │(OpenAI)   │  │  DBs   │
└───────┘   └───────────┘  └────────┘
```

---

## Module Breakdown

### 1. Authentication & RBAC
- JWT-based authentication
- Role hierarchy: Super Admin > Admin > User > Guest
- Permission checks on all endpoints
- Session management

### 2. Task Management
- CRUD operations for tasks
- Status workflow: New → In Progress → On Hold → Completed
- Priority levels: Low, Medium, High, Critical
- Multi-user assignments
- Comments, attachments, tags

### 3. Workflow Builder
- Visual drag-and-drop canvas
- Node types: Task, Condition, Approval, Notification
- Rule engine for automation
- Template management

### 4. Excel/CSV Import (MVP CRITICAL)
- Upload validation (file size, format)
- Column mapping interface
- Bulk task creation with error reporting
- Dry-run mode for preview

### 5. Database Connectors
- Connection management for:
  - SQL Server
  - PostgreSQL
  - MySQL
  - MongoDB
- Field mapping for workflow integration
- Secure credential storage

### 6. AI Assistant
- Natural language → workflow generation
- Task summarization
- Smart rule recommendations
- Conversational interface
- Uses Emergent LLM Key with OpenAI GPT-4o

### 7. Analytics Dashboard
- Task completion metrics
- SLA breach tracking
- Productivity insights
- Real-time charts

### 8. Audit Logging
- All user actions tracked
- Timestamp + user ID + action type
- Queryable logs for compliance

---

## Technology Stack Justification

| Technology | Reason |
|------------|--------|
| **React 19** | Latest features, concurrent rendering, modern hooks |
| **FastAPI** | High performance, async support, auto OpenAPI docs |
| **MongoDB** | Flexible schema, scalable, fast queries for workflow data |
| **JWT** | Stateless auth, scalable across microservices |
| **OpenAI GPT-4o** | Best NL understanding for workflow generation |
| **TailwindCSS** | Rapid UI development, consistent design system |
| **Framer Motion** | Smooth animations for drag-and-drop interactions |

---

## Data Flow Examples

### Task Creation Flow
```
User → Frontend Form → POST /api/tasks
  → Backend validates
  → Saves to MongoDB
  → Returns task object
  → Frontend updates UI
```

### Excel Import Flow
```
User uploads CSV → POST /api/tasks/import
  → Backend parses with Pandas
  → Validates each row
  → Creates tasks in batch
  → Generates error report
  → Returns summary + report URL
```

### AI Workflow Generation
```
User types NL description → POST /api/ai/generate-workflow
  → Backend calls OpenAI API
  → Parses AI response into workflow nodes
  → Returns workflow JSON
  → Frontend renders on canvas
```

---

## Security Considerations

1. **Authentication**: JWT tokens with 24h expiry
2. **Authorization**: Role-based checks on all endpoints
3. **Input Validation**: Pydantic models for all requests
4. **File Upload**: Max 10MB, only CSV/XLSX allowed
5. **Database**: Encrypted credentials for external DB connections
6. **Audit**: All actions logged with user context

---

## Scalability Plan

1. **Horizontal Scaling**: FastAPI instances behind load balancer
2. **Database**: MongoDB sharding for large datasets
3. **Caching**: Redis for session data and frequent queries
4. **CDN**: Static assets served from CDN
5. **Background Jobs**: Celery for long-running tasks (imports, exports)

---

## MVP Scope

✅ **MUST HAVE**:
- User auth + RBAC
- Task CRUD + Kanban/List views
- Excel/CSV bulk import
- Basic workflow builder
- AI workflow generation
- Analytics dashboard

⏳ **POST-MVP**:
- Timeline view
- Real-time WebSocket updates
- Email/Slack notifications
- Advanced rule engine
- Mobile app
- Workflow marketplace
