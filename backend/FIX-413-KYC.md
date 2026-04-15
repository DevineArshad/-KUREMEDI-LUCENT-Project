# Fix 413 Request Entity Too Large (KYC upload from website)

When users submit KYC on **https://kuremedi.com**, the request to `PUT https://backend.kuremedi.com/api/auth/kyc` returns **413** because **nginx** (on the API server) limits request body to **1 MB** by default. KYC images are often slightly over 1 MB.

## Fix on the API server (where backend.kuremedi.com runs)

You must **SSH into the server** that hosts `backend.kuremedi.com` and update nginx.

### Step 1: Find the nginx config for the API

```bash
sudo grep -r "backend.kuremedi.com\|proxy_pass.*5000\|proxy_pass.*api" /etc/nginx/
```

Or list sites:

```bash
ls /etc/nginx/sites-enabled/
ls /etc/nginx/conf.d/
```

Open the file that defines the `server` block for `backend.kuremedi.com` (e.g. `/etc/nginx/sites-available/default` or a file in `conf.d/`).

### Step 2: Add one line inside the `server { ... }` block

Add this **inside** the `server { }` that handles `backend.kuremedi.com` (e.g. right after `server_name backend.kuremedi.com;`):

```nginx
client_max_body_size 20M;
```

Example:

```nginx
server {
    listen 80;
    server_name backend.kuremedi.com;
    client_max_body_size 20M;   # <-- add this line

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

If you use a separate config for HTTPS (e.g. managed by certbot), add the same line in that `server { }` block as well.

### Step 3: Test and reload nginx

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Step 4: Test KYC again

On https://kuremedi.com, submit KYC again. The 413 error should be gone.

---

**Note:** The change is only on the **server**. No change is needed in the website or backend code.
