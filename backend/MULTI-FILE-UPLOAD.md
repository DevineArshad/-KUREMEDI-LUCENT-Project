# Multi-File Upload Configuration Guide

This document explains how to properly configure your server for handling multiple file uploads (e.g., product images).

## Problem
When users try to add multiple photos to products, the upload fails with "action failed" or network errors. This typically happens because of **size limits** at multiple layers:
- Nginx request body limit (default 1MB)
- Express JSON parser limit
- Multer file size limit  
- Multer total limit

## Solution

### 1. Backend Configuration (Already Applied)

The backend is configured to handle:
- **50MB per file** (Multer file size limit)
- **50MB total JSON payload** (Express limit)
- **Up to 10 files** per request

See the changes in:
- [middleware/createUpload.js](./middleware/createUpload.js) - Multer limits
- [index.js](./index.js) - Express middleware limits

### 2. Nginx Server Configuration (Manual Setup Required)

You **must update the nginx configuration** on your production server hosting `backend.kuremedi.com`.

#### Step 1: SSH into your API server
```bash
ssh ubuntu@your-api-server-ip
```

#### Step 2: Find the nginx config
```bash
sudo grep -r "backend.kuremedi.com\|proxy_pass.*5000" /etc/nginx/
```

Common locations:
- `/etc/nginx/sites-available/default`
- `/etc/nginx/sites-available/backend.kuremedi.com`
- `/etc/nginx/conf.d/api.conf`

#### Step 3: Update the server block

Add/update this line in the `server { }` block that handles `backend.kuremedi.com`:

```nginx
server {
    listen 443 ssl http2;
    server_name backend.kuremedi.com;

    ssl_certificate /etc/letsencrypt/live/backend.kuremedi.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/backend.kuremedi.com/privkey.pem;

    # Increase request body size for file uploads
    client_max_body_size 50M;

    # Increase timeouts for large file uploads
    proxy_connect_timeout 120s;
    proxy_send_timeout 120s;
    proxy_read_timeout 120s;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "upgrade";
        proxy_set_header Upgrade $http_upgrade;
    }
}
```

**If using certbot for HTTPS**, you may have separate `http` and `https` blocks. Add `client_max_body_size 50M;` to **both** blocks.

#### Step 4: Test nginx config
```bash
sudo nginx -t
```

Expected output:
```
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration will be successful
```

#### Step 5: Reload nginx
```bash
sudo systemctl reload nginx
```

### 3. Local Development Setup

For local testing (`http://localhost:5000`), no additional configuration is needed since the backend is already configured.

## Testing

### Test via Frontend (Admin Dashboard)
1. Go to Products page
2. Add a new product
3. Upload 3-6 images
4. Submit

### Test via cURL
```bash
# Upload multiple images
curl -X POST http://localhost:5000/api/products \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "productName=Test Product" \
  -F "mrp=500" \
  -F "sellingPrice=400" \
  -F "category=CATEGORY_ID" \
  -F "brand=BRAND_ID" \
  -F "productImages=@image1.jpg" \
  -F "productImages=@image2.jpg" \
  -F "productImages=@image3.jpg"
```

## Troubleshooting

### "413 Request Entity Too Large"
- Missing or incorrect `client_max_body_size` in nginx
- Reload nginx: `sudo systemctl reload nginx`

### "payload too large"
- Express limit too low (should be 50MB, check [index.js](./index.js))
- Restart backend: `npm start`

### "File too large"
- Multer limit too low (should be 50MB per file, check [middleware/createUpload.js](./middleware/createUpload.js))
- Restart backend

### Timeout errors
- Nginx timeouts too low
- Increase `proxy_send_timeout` and `proxy_read_timeout` in nginx

### Files uploaded but product not saved
- Check Cloudinary credentials in `.env`
- Verify `CLOUDINARY_URL` or `CLOUDINARY_CLOUD_NAME` is set
- Check backend logs: `tail -f backend.log`

## File Size Estimates

For reference, typical file sizes:
- **Product photo (3000×3000 JPG)**: 500KB - 2MB
- **6 photos (optimized)**: 3-12MB total
- **Safe limit**: 50MB per request covers most scenarios

## Related Issues

- **KYC upload failures**: See [FIX-413-KYC.md](./FIX-413-KYC.md)
- **CORS errors**: See [../backend/index.js](./index.js) - CORS configuration
