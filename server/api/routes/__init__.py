"""API Routes - Modular FastAPI routers"""

from server.api.routes.health import router as health_router
from server.api.routes.commands import router as commands_router
from server.api.routes.agent import router as agent_router
from server.api.routes.config import router as config_router
from server.api.routes.frontend import router as frontend_router
from server.api.routes.browsers import router as browsers_router

__all__ = [
    "health_router",
    "commands_router",
    "agent_router",
    "config_router",
    "frontend_router",
    "browsers_router",
]
