# Портал заявок ГУТВ

Это самостоятельное приложение для `gutv.tech`. Оно использует свой
контейнер `gutv-requests`, отдельный SQLite-файл `/data/requests.sqlite`,
отдельный том `gutv-requests-data` и собственные секреты авторизации.

Вход обрабатывается только собственной системой авторизации портала.

## Настройка

Секреты передаются только через окружение или отдельный файл на сервере:

```sh
export GUTV_ADMIN_USERNAME='studio'
export GUTV_PASSWORD_RECORD='pbkdf2-sha256$...'
export GUTV_SESSION_SECRET='base64url-encoded-secret'
```

Telegram необязателен:

```sh
export GUTV_TELEGRAM_BOT_TOKEN='...'
export GUTV_TELEGRAM_ADMIN_CHAT_ID='...'
```

Для первичной регистрации Callback API используется ключ сообщества. Он нужен
только команде настройки на сервере и не передаётся в контейнер или браузер:

```sh
export GUTV_VK_SERVICE_TOKEN='vk1.a...'
export GUTV_VK_GROUP_ID='30973272'
```

После публикации зарегистрируйте адрес
`https://gutv.tech/api/vk/callback` в Callback API сообщества и включите
событие `wall_post_new`. Код подтверждения передаётся контейнеру на время
регистрации через `GUTV_VK_CONFIRMATION_CODE`. Секрет Callback API вычисляется
приложением из `GUTV_SESSION_SECRET` и не отправляется в браузер.

## Запуск

Production-релизы передаются как tar.gz-архив с ожидаемой SHA-256:

```sh
sh /tmp/gutv-requests-deploy.sh /tmp/gutv-requests-release.tgz SHA256
```

Скрипт проверяет архив, делает online-backup SQLite, собирает и
проверяет изолированный образ и заменяет только `gutv-requests`.
Том заявок и сеть не пересоздаются.

После запуска добавьте `Caddyfile.snippet` в действующую конфигурацию Caddy,
проверьте её командой `caddy validate` и выполните reload.

Старый Callback URL на `gutv.cabinpxrn.ru` остаётся доступен в Caddy как
аварийный канал, пока новый адрес не прошёл проверку VK.
