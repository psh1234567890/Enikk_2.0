# O(1) bot database access

Copy .env.example to .env and set Discord and Supabase configuration.

O1_DB_ACCESS_KEY is a separate read-only credential for O(1) bot access.
It is not the Supabase anon/publishable key.
The C++ administrator uses a different key for read and write operations.

Do not commit .env or put access keys in issues, logs or screenshots.
Running bot processes must be restarted after .env updates.
Do not use Supabase service_role or secret keys in Discord bot clients.

Student data should be displayed only to authorized club members.
Restrict the Discord bot to the official club server and approved channels.