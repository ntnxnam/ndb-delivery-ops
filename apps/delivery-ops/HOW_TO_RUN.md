# 🚀 How to Run the Application

## Quick Start

### 1. Install Dependencies (if not already done)
```bash
npm run install-all
```

### 2. Configure SMTP Settings
```bash
# Copy the example environment file
cp server/.env.example server/.env

# Edit server/.env and add your SMTP credentials:
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USER=your-email@nutanix.com
# SMTP_PASS=your-app-password
# PORT=6001
```

### 3. Run the Application

**Option A: Run both frontend and backend together (Recommended)**
```bash
npm run dev
```

**Option B: Run separately**

Terminal 1 - Backend:
```bash
npm run server
```
Backend will run on: **http://localhost:6001**

Terminal 2 - Frontend:
```bash
npm run client
```
Frontend will run on: **http://localhost:6100**

### 4. Access the Application

- **Frontend (Web UI)**: Open your browser and go to **http://localhost:6100**
- **Backend API**: Available at **http://localhost:6001**

## Port Configuration

The application uses unusual port numbers to avoid conflicts:
- **Backend Server**: Port `6001`
- **Frontend React App**: Port `6100`

These ports can be changed by:
- Backend: Set `PORT` environment variable in `server/.env`
- Frontend: Set `PORT` environment variable before running (e.g., `PORT=9999 npm run client`)

## Troubleshooting

### Port Already in Use
If you get an error that the port is already in use:

**For Backend (6001):**
```bash
# Find what's using the port
lsof -i :6001

# Kill the process or change PORT in server/.env
```

**For Frontend (6100):**
```bash
# Find what's using the port
lsof -i :6100

# Or run with a different port
PORT=9999 npm run client
```

### Dependencies Not Installed
```bash
# Install all dependencies
npm run install-all

# Or install separately
npm install
cd server && npm install
cd ../client && npm install
```

### SMTP Configuration Issues
- Make sure `server/.env` exists and has correct SMTP credentials (service account for Nutanix relay).
- All email is sent **From** the service account (e.g. `svc.ndb.team@nutanix.com`); Reply-To is set to the sender so replies go to the right person.
- **Pre-deploy checklist**: Before production deploy, set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (and optionally SMTP_FROM) in server/.env; ensure server/config/emailConfig.json has smtp.from. See DEPLOYMENT_GUIDE.md for the full checklist.
- After deploy, run `cd server && node test-smtp.js` to verify SMTP (or rely on the optional email smoke step in the deployment script).
- For Gmail, you may need to use an "App Password" instead of your regular password

## Testing Email Functionality

### Quick Test Script
A test script is available to quickly test email sending:

```bash
# Make sure the server is running first (npm run dev)
# Then run:
node test-email.js <your-confluence-token>
```

This will:
1. Extract content from the test Confluence page
2. Construct the email body
3. Send it to namratha.singh@nutanix.com

**Example:**
```bash
node test-email.js ATATT3xFfGF0...
```
- Check that SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS are set correctly

## Development Workflow

1. **Start the application**: `npm run dev`
2. **Make changes** to code
3. **Hot reload** - Both frontend and backend support hot reloading
4. **Check the browser** at http://localhost:6100

## Production Build

To create production builds:

```bash
# Build frontend
cd client && npm run build

# The built files will be in client/build/
```

