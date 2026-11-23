/**
 * Quem pode fazer o quê. Toda rota da API declara a permissão que exige
 * (ver middleware `authorize`); para mudar o acesso de um papel, mude só aqui.
 */
export const ROLES = ['admin', 'funcionario'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'products:read',
  'products:write',
  'products:delete',
  'lots:read',
  'lots:write',
  'lots:delete',
  'movements:write',
  'categories:read',
  'categories:write',
  'reports:read',
  'settings:write',
  'users:manage',
  'audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  funcionario: [
    'products:read',
    'products:write',
    'lots:read',
    'lots:write',
    'movements:write',
    'categories:read',
  ],
};

export function permissionsOf(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function can(role: Role, permission: Permission): boolean {
  return permissionsOf(role).includes(permission);
}
