# Заявки на съёмки ГУТВ

Самостоятельный Next.js-портал для `gutv.tech`.

- Публичная страница студии открывается по `/` без авторизации.
- Факультеты и организации регистрируются и работают в `/cabinet`.
- Руководство ГУТВ обрабатывает заявки в `/management`.
- База заявок и вложения находятся в отдельном Docker-томе.

Локальный запуск:

```sh
GUTV_DATABASE_PATH=./requests.sqlite \
GUTV_PASSWORD_RECORD='pbkdf2-sha256$...' \
GUTV_SESSION_SECRET='base64url-secret' \
pnpm dev
```

Требования и сценарии описаны в `docs/PRD-shooting-requests.md`, а production
развёртывание — в `deploy/requests/README.md`.
