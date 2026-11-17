/**
 * Who may do what in the team area. Roles are bundles of explicit permissions;
 * every server route names the permission it needs, and record access is then
 * narrowed by scope (own leads, team leads, or all). The browser reads the same
 * table only to decide what to show: the server never trusts it.
 *
 * `super_admin` is the owner account from the environment. It cannot be
 * created, edited or removed from inside the app.
 */
export const TEAM_ROLES = ['admin', 'manager', 'rep', 'analyst'] as const;
/** Roles that can be given to an invited team member. */
export type TeamRole = (typeof TEAM_ROLES)[number];
export type Role = TeamRole | 'super_admin';

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Owner',
  admin: 'Admin',
  manager: 'Sales manager',
  rep: 'Sales representative',
  analyst: 'Read-only analyst',
};

export const PERMISSIONS = [
  'leads.read', // open leads in your scope
  'leads.write', // status, notes, activities, tasks, opportunities on leads in your scope
  'leads.create', // add a lead by hand
  'leads.assign', // assign or reassign leads in your scope
  'leads.export', // download leads as a file
  'leads.claim', // take an unassigned lead (when claiming is switched on)
  'orders.write', // record and progress orders on leads in your scope
  'orders.confirm', // confirm activation, completion or reversal with evidence
  'team.read', // team performance in your scope
  'analytics.read', // business overview and funnel
  'catalog.read', // providers and products
  'catalog.manage', // change providers and products
  'users.manage', // invite and manage representatives, managers and analysts
  'users.manage_admins', // invite and manage admins
  'settings.manage', // locations, service areas, routing settings
  'audit.read', // read the audit log
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Which records a role sees when it has a read or write permission on them. */
export type Scope = 'all' | 'team' | 'own';

const REP: Permission[] = ['leads.read', 'leads.write', 'leads.create', 'leads.claim', 'orders.write', 'catalog.read'];
const MANAGER: Permission[] = [...REP, 'leads.assign', 'orders.confirm', 'team.read'];
const ANALYST: Permission[] = ['leads.read', 'team.read', 'analytics.read', 'catalog.read'];
const ADMIN: Permission[] = [...new Set<Permission>([...MANAGER, ...ANALYST, 'leads.export', 'catalog.manage', 'users.manage', 'settings.manage', 'audit.read'])];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  rep: REP,
  manager: MANAGER,
  analyst: ANALYST,
  admin: ADMIN,
  // Managing admins needs the owner.
  super_admin: PERMISSIONS,
};

export const ROLE_SCOPE: Record<Role, Scope> = { rep: 'own', manager: 'team', analyst: 'all', admin: 'all', super_admin: 'all' };

export const can = (role: Role, permission: Permission): boolean => ROLE_PERMISSIONS[role].includes(permission);

/** Roles that must use a second sign-in step. */
export const MFA_REQUIRED_ROLES: readonly Role[] = ['admin', 'manager'];

/** May `actor` give or take away `target`? Nobody can hand out a role above their own powers. */
export function canGrantRole(actor: Role, target: TeamRole): boolean {
  if (target === 'admin') return can(actor, 'users.manage_admins');
  return can(actor, 'users.manage');
}

export const USER_STATUSES = ['invited', 'active', 'suspended', 'deactivated'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
export const USER_STATUS_LABEL: Record<UserStatus, string> = { invited: 'Invited', active: 'Active', suspended: 'Suspended', deactivated: 'Deactivated' };
