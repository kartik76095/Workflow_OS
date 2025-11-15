import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, ListTodo, Workflow, BarChart3, Users, Sparkles, Upload, LogOut, Building2 } from 'lucide-react';
import { Button } from './ui/button';

export default function Layout({ children, user, setUser }) {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
    navigate('/login');
  };

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Tasks', href: '/tasks', icon: ListTodo },
    { name: 'Import Tasks', href: '/tasks/import', icon: Upload },
    { name: 'Workflows', href: '/workflows', icon: Workflow },
    { name: 'Analytics', href: '/analytics', icon: BarChart3 },
    { name: 'AI Assistant', href: '/ai', icon: Sparkles },
  ];

  if (user?.role === 'admin' || user?.role === 'super_admin') {
    navigation.push({ name: 'Users', href: '/users', icon: Users });
  }

  return (
    <div className="min-h-screen bg-[#f5f7fa]">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-64 bg-white border-r border-[#e2e8f0] flex flex-col">
        <div className="p-6 border-b border-[#e2e8f0]">
          <h1 className="text-2xl font-bold" style={{ color: '#0a69a7', fontFamily: 'Space Grotesk, sans-serif' }}>
            Katalusis
          </h1>
          <p className="text-sm text-[#718096] mt-1">Workflow OS</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.name}
                to={item.href}
                data-testid={`nav-${item.name.toLowerCase().replace(/ /g, '-')}`}
                className={`flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-all ${
                  isActive
                    ? 'bg-[#70bae7] bg-opacity-10 text-[#0a69a7]'
                    : 'text-[#4a5568] hover:bg-[#eff2f5]'
                }`}
              >
                <Icon className="w-5 h-5 mr-3" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[#e2e8f0]">
          <div className="flex items-center mb-3">
            <div className="w-10 h-10 rounded-full bg-[#70bae7] flex items-center justify-center text-white font-semibold">
              {user?.full_name?.charAt(0).toUpperCase()}
            </div>
            <div className="ml-3 flex-1">
              <p className="text-sm font-medium text-[#1a202c]">{user?.full_name}</p>
              <p className="text-xs text-[#718096] capitalize">{user?.role?.replace('_', ' ')}</p>
            </div>
          </div>
          <Button
            data-testid="logout-button"
            onClick={handleLogout}
            variant="outline"
            className="w-full"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-64 p-8">
        {children}
      </main>
    </div>
  );
}
