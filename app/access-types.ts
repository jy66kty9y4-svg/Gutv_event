export const privileges = [
  { id: 'panel.access', name: 'Вход в панель руководства', description: 'Открывать панель и разрешённые разделы.' },
  { id: 'applications.manage', name: 'Заявки', description: 'Просматривать все заявки и вложения, менять статусы, команду и комментарии.' },
  { id: 'organizations.manage', name: 'Организации', description: 'Подтверждать регистрации и менять статус аккаунтов организаций.' },
  { id: 'specialties.manage', name: 'Специалисты', description: 'Добавлять специальности и отправлять их в архив.' },
  { id: 'leadership.manage', name: 'Руководящий состав', description: 'Редактировать людей, должности и фотографии на сайте.' },
  { id: 'projects.manage', name: 'Проекты', description: 'Добавлять и редактировать публичные карточки проектов.' },
  { id: 'access.manage', name: 'Роли, пользователи и администраторы', description: 'Полное управление доступом: менять роли и привилегии, назначать и снимать администраторов.' },
] as const;

export type Privilege = typeof privileges[number]['id'];
export const allPrivileges: Privilege[] = privileges.map(item => item.id);
export type AccessRole = { id: number; name: string; description: string; administrator: boolean; privileges: Privilege[]; memberCount: number; revision: number };
export type AccessUser = { id: number; username: string; displayName: string; organizationName: string | null; status: string; protected: boolean; roleIds: number[]; revision: number; hiddenAt?: string | null };
export type AccessSnapshot = { roles: AccessRole[]; users: AccessUser[]; currentAccountId: number };
