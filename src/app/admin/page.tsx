"use client";
// @ts-nocheck

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Settings,
  Shield,
  ShieldCheck,
  Users,
  UserPlus,
  Key,
  Lock,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Activity,
  Globe,
  Server,
  Eye,
  EyeOff,
  Fingerprint,
  ChevronRight,
  ChevronDown,
  Search,
  Filter,
  Copy,
  Trash2,
  RefreshCw,
  Edit3,
  Building2,
  Palette,
  ToggleLeft,
  ToggleRight,
  Wifi,
  WifiOff,
  Timer,
  Smartphone,
  MapPin,
  Cpu,
  FileText,
  Layers,
  Zap,
  Download,
  BarChart3,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";

// ============================================================
// Mock Data
// ============================================================

const roles = [
  {
    id: "admin",
    name: "Admin",
    description: "Full access to all features",
    users: 2,
    color: "text-brand-400 bg-brand-500/10",
  },
  {
    id: "operator",
    name: "Operator",
    description: "Manage credentials and verifications",
    users: 3,
    color: "text-identity-chrome bg-identity-chrome/10",
  },
  {
    id: "compliance",
    name: "Compliance Officer",
    description: "Run screenings, manage compliance",
    users: 2,
    color: "text-amber-400 bg-amber-500/10",
  },
  {
    id: "auditor",
    name: "Auditor",
    description: "View-only access to audit trails",
    users: 1,
    color: "text-identity-steel bg-identity-steel/10",
  },
  {
    id: "viewer",
    name: "Viewer",
    description: "Read-only access to dashboards",
    users: 4,
    color: "text-zero-400 bg-zero-500/10",
  },
];

const rbacMatrix = [
  {
    permission: "View Credentials",
    admin: true,
    operator: true,
    compliance: true,
    auditor: true,
    viewer: true,
  },
  {
    permission: "Issue Credentials",
    admin: true,
    operator: true,
    compliance: false,
    auditor: false,
    viewer: false,
  },
  {
    permission: "Revoke Credentials",
    admin: true,
    operator: false,
    compliance: true,
    auditor: false,
    viewer: false,
  },
  {
    permission: "Run Screening",
    admin: true,
    operator: true,
    compliance: true,
    auditor: false,
    viewer: false,
  },
  {
    permission: "View Audit Log",
    admin: true,
    operator: true,
    compliance: true,
    auditor: true,
    viewer: false,
  },
  {
    permission: "Manage Team",
    admin: true,
    operator: false,
    compliance: false,
    auditor: false,
    viewer: false,
  },
  {
    permission: "API Key Management",
    admin: true,
    operator: false,
    compliance: false,
    auditor: false,
    viewer: false,
  },
  {
    permission: "Configure OIDC",
    admin: true,
    operator: false,
    compliance: false,
    auditor: false,
    viewer: false,
  },
  {
    permission: "Manage Webhooks",
    admin: true,
    operator: true,
    compliance: false,
    auditor: false,
    viewer: false,
  },
  {
    permission: "View Analytics",
    admin: true,
    operator: true,
    compliance: true,
    auditor: true,
    viewer: true,
  },
  {
    permission: "Manage Agents",
    admin: true,
    operator: true,
    compliance: false,
    auditor: false,
    viewer: false,
  },
  {
    permission: "Billing Access",
    admin: true,
    operator: false,
    compliance: false,
    auditor: false,
    viewer: false,
  },
];

const teamMembers = [
  {
    id: "m1",
    name: "Sarah Chen",
    email: "sarah@acme-corp.com",
    role: "Admin",
    status: "active" as const,
    mfaEnabled: true,
    lastActive: "2 min ago",
    sessions: 1,
  },
  {
    id: "m2",
    name: "James Wilson",
    email: "james@acme-corp.com",
    role: "Operator",
    status: "active" as const,
    mfaEnabled: true,
    lastActive: "1h ago",
    sessions: 2,
  },
  {
    id: "m3",
    name: "Maria Santos",
    email: "maria@acme-corp.com",
    role: "Compliance Officer",
    status: "active" as const,
    mfaEnabled: true,
    lastActive: "30 min ago",
    sessions: 1,
  },
  {
    id: "m4",
    name: "Ahmed Al-Rashid",
    email: "ahmed@acme-corp.com",
    role: "Viewer",
    status: "active" as const,
    mfaEnabled: false,
    lastActive: "2d ago",
    sessions: 0,
  },
  {
    id: "m5",
    name: "Priya Sharma",
    email: "priya@acme-corp.com",
    role: "Auditor",
    status: "active" as const,
    mfaEnabled: true,
    lastActive: "5h ago",
    sessions: 1,
  },
  {
    id: "m6",
    name: "Tom Richardson",
    email: "tom@acme-corp.com",
    role: "Operator",
    status: "pending" as const,
    mfaEnabled: false,
    lastActive: "Invited",
    sessions: 0,
  },
  {
    id: "m7",
    name: "Yuki Tanaka",
    email: "yuki@acme-corp.com",
    role: "Viewer",
    status: "active" as const,
    mfaEnabled: true,
    lastActive: "12h ago",
    sessions: 1,
  },
];

const activityLog = [
  {
    id: "a1",
    user: "Sarah Chen",
    action: 'Created API key "Production - Analytics"',
    timestamp: "10 min ago",
    category: "api-keys" as const,
  },
  {
    id: "a2",
    user: "James Wilson",
    action: "Issued credential to did:aethelred:0xf3a...92b1",
    timestamp: "25 min ago",
    category: "credentials" as const,
  },
  {
    id: "a3",
    user: "Maria Santos",
    action: "Completed sanctions screening batch (142 entities)",
    timestamp: "1h ago",
    category: "compliance" as const,
  },
  {
    id: "a4",
    user: "Sarah Chen",
    action: "Updated MFA policy: require hardware key",
    timestamp: "2h ago",
    category: "security" as const,
  },
  {
    id: "a5",
    user: "James Wilson",
    action: "Configured webhook for credential.verified event",
    timestamp: "3h ago",
    category: "webhooks" as const,
  },
  {
    id: "a6",
    user: "Sarah Chen",
    action: "Invited Tom Richardson as Operator",
    timestamp: "4h ago",
    category: "team" as const,
  },
  {
    id: "a7",
    user: "Priya Sharma",
    action: "Exported audit report for Q1 2026",
    timestamp: "5h ago",
    category: "audit" as const,
  },
  {
    id: "a8",
    user: "Maria Santos",
    action: "Escalated PEP match to compliance team",
    timestamp: "6h ago",
    category: "compliance" as const,
  },
];

const securityPolicies = {
  sessionTimeout: 30,
  mfaRequired: true,
  mfaType: "TOTP + Hardware Key",
  ipRestrictions: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
  maxSessions: 3,
  passwordPolicy: "12+ chars, uppercase, number, special",
  loginAttempts: 5,
  apiRateLimit: 1000,
};

const deploymentConfig = {
  teeProvider: "Intel SGX",
  teeNodes: 5,
  zkBackend: "Groth16 (Circom)",
  network: "Aethelred Mainnet",
  dataSovereignty: "UAE - Dubai",
  backupRegion: "Singapore",
};

const categoryColors: Record<string, string> = {
  "api-keys": "text-brand-400",
  credentials: "text-emerald-400",
  compliance: "text-amber-400",
  security: "text-red-400",
  webhooks: "text-identity-chrome",
  team: "text-blue-400",
  audit: "text-identity-steel",
};

// ============================================================
// Component
// ============================================================

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<
    "rbac" | "team" | "activity" | "security" | "org" | "deployment"
  >("rbac");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState<string>("all");

  const filteredMembers = teamMembers.filter(
    (m) =>
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.email.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const filteredLogs = activityLog.filter(
    (l) => logFilter === "all" || l.category === logFilter,
  );

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <Shield className="w-7 h-7 text-brand-400" />
              Admin & RBAC Management
            </h1>
            <p className="text-[var(--text-secondary)] mt-1">
              Manage roles, team members, security policies, and platform
              configuration
            </p>
          </div>
          <button className="btn-primary">
            <UserPlus className="w-4 h-4" /> Invite Member
          </button>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            {
              label: "Team Members",
              value: String(teamMembers.length),
              icon: Users,
              color: "text-brand-400",
              trend: "1 pending",
            },
            {
              label: "Active Roles",
              value: String(roles.length),
              icon: Shield,
              color: "text-identity-chrome",
              trend: "12 permissions",
            },
            {
              label: "MFA Enabled",
              value: `${teamMembers.filter((m) => m.mfaEnabled).length}/${teamMembers.length}`,
              icon: Smartphone,
              color: "text-emerald-400",
              trend: "1 pending setup",
            },
            {
              label: "Active Sessions",
              value: String(teamMembers.reduce((a, b) => a + b.sessions, 0)),
              icon: Activity,
              color: "text-amber-400",
              trend: "Max 3 per user",
            },
            {
              label: "Admin Actions (24h)",
              value: String(activityLog.length),
              icon: FileText,
              color: "text-identity-steel",
              trend: "All logged",
            },
          ].map((m, i) => (
            <motion.div
              key={m.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-zero-900 border border-zero-800 rounded-2xl p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <m.icon className={`w-4 h-4 ${m.color}`} />
                <span className="text-xs text-zero-500">{m.label}</span>
              </div>
              <div className="text-xl font-bold">{m.value}</div>
              <div className="text-xs text-zero-500 mt-1">{m.trend}</div>
            </motion.div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {[
            { id: "rbac" as const, label: "RBAC Matrix", icon: Layers },
            { id: "team" as const, label: "Team", icon: Users },
            { id: "activity" as const, label: "Activity Log", icon: Activity },
            { id: "security" as const, label: "Security Policies", icon: Lock },
            { id: "org" as const, label: "Organization", icon: Building2 },
            { id: "deployment" as const, label: "Deployment", icon: Server },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-brand-600 text-white"
                  : "bg-zero-900 border border-zero-800 text-zero-400 hover:text-white"
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <AnimatePresence mode="wait">
          {/* RBAC Matrix */}
          {activeTab === "rbac" && (
            <motion.div
              key="rbac"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              {/* Roles Overview */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                {roles.map((role) => (
                  <button
                    key={role.id}
                    onClick={() =>
                      setSelectedRole(selectedRole === role.id ? null : role.id)
                    }
                    className={`p-4 rounded-xl border text-left transition-all ${
                      selectedRole === role.id
                        ? "border-brand-500 bg-brand-600/10"
                        : "border-zero-800 bg-zero-900 hover:border-zero-700"
                    }`}
                  >
                    <div
                      className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium mb-2 ${role.color}`}
                    >
                      {role.name}
                    </div>
                    <div className="text-xs text-zero-500">
                      {role.description}
                    </div>
                    <div className="text-xs text-zero-600 mt-1">
                      {role.users} users
                    </div>
                  </button>
                ))}
              </div>

              {/* Permission Matrix */}
              <div className="card">
                <div className="p-4 border-b border-zero-800">
                  <h2 className="font-semibold">Permission Matrix</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zero-800">
                        <th className="text-left py-3 px-4 text-zero-500 font-medium">
                          Permission
                        </th>
                        {roles.map((r) => (
                          <th
                            key={r.id}
                            className="text-center py-3 px-3 text-zero-400 font-medium text-xs"
                          >
                            {r.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rbacMatrix.map((row) => (
                        <tr
                          key={row.permission}
                          className="border-b border-zero-800/50 hover:bg-zero-800/20"
                        >
                          <td className="py-2.5 px-4 text-zero-300">
                            {row.permission}
                          </td>
                          {[
                            row.admin,
                            row.operator,
                            row.compliance,
                            row.auditor,
                            row.viewer,
                          ].map((has, ci) => (
                            <td key={ci} className="text-center py-2.5 px-3">
                              {has ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" />
                              ) : (
                                <XCircle className="w-4 h-4 text-zero-700 mx-auto" />
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* Team Management */}
          {activeTab === "team" && (
            <motion.div
              key="team"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zero-500" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search team members..."
                  className="w-full pl-10 pr-4 py-2.5 bg-zero-900 border border-zero-800 rounded-xl text-sm focus:outline-none focus:border-brand-500"
                />
              </div>

              <div className="card divide-y divide-zero-800/50">
                {filteredMembers.map((member, i) => (
                  <motion.div
                    key={member.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 }}
                    className="p-4 flex items-center gap-4"
                  >
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-600 to-identity-chrome flex items-center justify-center text-white font-bold text-sm">
                      {member.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          {member.name}
                        </span>
                        {member.status === "pending" && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 text-[9px]">
                            Pending
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-zero-500">
                        {member.email}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {member.mfaEnabled ? (
                        <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                          <Smartphone className="w-3 h-3" />
                          MFA
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] text-amber-400">
                          <AlertTriangle className="w-3 h-3" />
                          No MFA
                        </span>
                      )}
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        roles.find((r) => r.name === member.role)!.color
                      }`}
                    >
                      {member.role}
                    </span>
                    <span className="text-xs text-zero-500 w-20 text-right">
                      {member.lastActive}
                    </span>
                    <div className="flex items-center gap-1">
                      <button className="p-1.5 rounded-lg hover:bg-zero-800 text-zero-500 hover:text-white">
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button className="p-1.5 rounded-lg hover:bg-zero-800 text-zero-500 hover:text-red-400">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Activity Log */}
          {activeTab === "activity" && (
            <motion.div
              key="activity"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="flex items-center gap-2 overflow-x-auto">
                {[
                  "all",
                  "api-keys",
                  "credentials",
                  "compliance",
                  "security",
                  "webhooks",
                  "team",
                  "audit",
                ].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setLogFilter(cat)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                      logFilter === cat
                        ? "bg-brand-600 text-white"
                        : "bg-zero-900 border border-zero-800 text-zero-400 hover:text-white"
                    }`}
                  >
                    {cat === "all"
                      ? "All"
                      : cat
                          .replace("-", " ")
                          .replace(/\b\w/g, (l) => l.toUpperCase())}
                  </button>
                ))}
              </div>

              <div className="card divide-y divide-zero-800/50">
                {filteredLogs.map((log, i) => (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="p-4 flex items-center gap-4 hover:bg-zero-800/20 transition-colors"
                  >
                    <div
                      className={`w-2 h-2 rounded-full shrink-0 ${categoryColors[log.category]}`}
                      style={{ backgroundColor: "currentColor" }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm">
                        <span className="font-medium text-zero-200">
                          {log.user}
                        </span>
                        <span className="text-zero-400 ml-1">{log.action}</span>
                      </div>
                    </div>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] ${categoryColors[log.category]}`}
                    >
                      {log.category.replace("-", " ")}
                    </span>
                    <span className="text-xs text-zero-600 shrink-0">
                      {log.timestamp}
                    </span>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Security Policies */}
          {activeTab === "security" && (
            <motion.div
              key="security"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Authentication */}
                <div className="card p-6">
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <Lock className="w-4 h-4 text-brand-400" />
                    Authentication Policy
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-zero-800/50 rounded-xl">
                      <div>
                        <div className="text-sm font-medium">MFA Required</div>
                        <div className="text-[10px] text-zero-500">
                          {securityPolicies.mfaType}
                        </div>
                      </div>
                      <div className="w-10 h-5 bg-emerald-500 rounded-full relative cursor-pointer">
                        <div className="absolute right-0.5 top-0.5 w-4 h-4 bg-white rounded-full" />
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zero-400">Session Timeout</span>
                      <span className="font-medium">
                        {securityPolicies.sessionTimeout} minutes
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zero-400">
                        Max Concurrent Sessions
                      </span>
                      <span className="font-medium">
                        {securityPolicies.maxSessions}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zero-400">Password Policy</span>
                      <span className="font-medium text-xs">
                        {securityPolicies.passwordPolicy}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zero-400">Max Login Attempts</span>
                      <span className="font-medium">
                        {securityPolicies.loginAttempts}
                      </span>
                    </div>
                  </div>
                </div>

                {/* IP Restrictions */}
                <div className="card p-6">
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <Wifi className="w-4 h-4 text-identity-steel" />
                    Network & IP Restrictions
                  </h3>
                  <div className="space-y-2 mb-4">
                    {securityPolicies.ipRestrictions.map((ip) => (
                      <div
                        key={ip}
                        className="flex items-center justify-between p-2.5 bg-zero-800/50 rounded-lg"
                      >
                        <code className="text-sm text-zero-300 font-mono">
                          {ip}
                        </code>
                        <div className="flex items-center gap-1">
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[9px]">
                            Allowed
                          </span>
                          <button className="p-1 rounded hover:bg-zero-700 text-zero-500 hover:text-red-400">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button className="w-full py-2 rounded-lg border border-dashed border-zero-700 text-xs text-zero-500 hover:text-white hover:border-zero-500 transition-colors">
                    + Add IP Range
                  </button>
                  <div className="mt-4 flex items-center justify-between text-sm">
                    <span className="text-zero-400">API Rate Limit</span>
                    <span className="font-medium">
                      {securityPolicies.apiRateLimit} req/min
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Organization Settings */}
          {activeTab === "org" && (
            <motion.div
              key="org"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="card p-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-brand-400" />
                  Organization Settings
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1.5">
                      Organization Name
                    </label>
                    <input
                      className="w-full px-3 py-2.5 bg-zero-800 border border-zero-700 rounded-xl text-sm focus:outline-none focus:border-brand-500"
                      defaultValue="ACME Corporation"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1.5">
                        Default Jurisdiction
                      </label>
                      <select className="w-full px-3 py-2.5 bg-zero-800 border border-zero-700 rounded-xl text-sm focus:outline-none focus:border-brand-500">
                        <option>United Arab Emirates</option>
                        <option>United States</option>
                        <option>European Union</option>
                        <option>Singapore</option>
                        <option>United Kingdom</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5">
                        Compliance Framework
                      </label>
                      <select className="w-full px-3 py-2.5 bg-zero-800 border border-zero-700 rounded-xl text-sm focus:outline-none focus:border-brand-500">
                        <option>VARA / CBUAE</option>
                        <option>MiCA</option>
                        <option>SEC / FinCEN</option>
                        <option>FCA</option>
                        <option>MAS</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">
                      Branding
                    </label>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="p-3 bg-zero-800/50 rounded-xl text-center">
                        <Palette className="w-5 h-5 mx-auto mb-1 text-brand-400" />
                        <div className="text-xs text-zero-500">
                          Primary Color
                        </div>
                        <div className="w-8 h-8 mx-auto mt-2 rounded-lg bg-brand-500 border border-brand-400/30" />
                      </div>
                      <div className="p-3 bg-zero-800/50 rounded-xl text-center">
                        <FileText className="w-5 h-5 mx-auto mb-1 text-zero-400" />
                        <div className="text-xs text-zero-500">Logo</div>
                        <button className="text-[10px] text-brand-400 mt-2">
                          Upload
                        </button>
                      </div>
                      <div className="p-3 bg-zero-800/50 rounded-xl text-center">
                        <Globe className="w-5 h-5 mx-auto mb-1 text-zero-400" />
                        <div className="text-xs text-zero-500">Domain</div>
                        <div className="text-[10px] text-zero-300 mt-2">
                          id.acme-corp.com
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-zero-800/50 rounded-xl">
                    <div>
                      <div className="text-sm font-medium">
                        Auto-renew Credentials
                      </div>
                      <div className="text-[10px] text-zero-500">
                        Automatically renew expiring credentials via TEE
                      </div>
                    </div>
                    <div className="w-10 h-5 bg-emerald-500 rounded-full relative cursor-pointer">
                      <div className="absolute right-0.5 top-0.5 w-4 h-4 bg-white rounded-full" />
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Deployment Configuration */}
          {activeTab === "deployment" && (
            <motion.div
              key="deployment"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="card p-6">
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-brand-400" />
                    TEE Configuration
                  </h3>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-zero-400">Provider</span>
                      <span className="font-medium">
                        {deploymentConfig.teeProvider}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-zero-400">Active Nodes</span>
                      <span className="font-medium text-emerald-400">
                        {deploymentConfig.teeNodes} /{" "}
                        {deploymentConfig.teeNodes}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-zero-400">Attestation Status</span>
                      <span className="text-emerald-400 font-medium">
                        Valid
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-zero-400">Auto-scaling</span>
                      <span className="text-emerald-400 font-medium">
                        Enabled
                      </span>
                    </div>
                  </div>
                </div>

                <div className="card p-6">
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <Fingerprint className="w-4 h-4 text-identity-chrome" />
                    ZK Backend
                  </h3>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-zero-400">Proving System</span>
                      <span className="font-medium">
                        {deploymentConfig.zkBackend}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-zero-400">Avg Proof Time</span>
                      <span className="font-medium">287ms</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-zero-400">Verification Cost</span>
                      <span className="font-medium">~$0.02</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-zero-400">Circuit Version</span>
                      <span className="font-medium">v2.4.1</span>
                    </div>
                  </div>
                </div>

                <div className="card p-6">
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <Globe className="w-4 h-4 text-identity-steel" />
                    Network
                  </h3>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-zero-400">Network</span>
                      <span className="font-medium">
                        {deploymentConfig.network}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-zero-400">Primary Region</span>
                      <span className="font-medium">
                        {deploymentConfig.dataSovereignty}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-zero-400">Backup Region</span>
                      <span className="font-medium">
                        {deploymentConfig.backupRegion}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-zero-400">RPC Endpoint</span>
                      <span className="font-medium text-xs font-mono">
                        rpc.aethelred.io
                      </span>
                    </div>
                  </div>
                </div>

                <div className="card p-6">
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-identity-amber" />
                    Resource Usage
                  </h3>
                  <div className="space-y-3">
                    {[
                      { label: "CPU", usage: 42, max: "8 vCPU" },
                      { label: "Memory", usage: 85, max: "32 GB" },
                      { label: "Storage", usage: 67, max: "500 GB" },
                      { label: "Bandwidth", usage: 18, max: "10 TB/mo" },
                    ].map((resource) => (
                      <div key={resource.label}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-zero-400">
                            {resource.label}
                          </span>
                          <span className="text-xs text-zero-500">
                            {resource.usage}% of {resource.max}
                          </span>
                        </div>
                        <div className="w-full bg-zero-800 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${resource.usage < 50 ? "bg-emerald-500" : resource.usage < 80 ? "bg-amber-500" : "bg-red-500"}`}
                            style={{ width: `${resource.usage}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppLayout>
  );
}
