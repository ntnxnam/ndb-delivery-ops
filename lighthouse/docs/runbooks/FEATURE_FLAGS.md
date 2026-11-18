# Deployment Feature Flags Guide

This application supports environment-based feature flags to enable/disable the Release Versions page for different deployments.

## Feature Flag: `REACT_APP_ENABLE_TRENDS_AND_RISK`

Controls visibility of the **Trends & risk** section on the Release Versions tab (snapshots, pie chart, tasks-over-time, risk moves). Hidden by default while the feature is in development.

- Set `REACT_APP_ENABLE_TRENDS_AND_RISK=true` in the client environment (e.g. in `client/.env`) to show the section.
- Unset or `false`: section is not rendered.

## Feature Flag: `REACT_APP_ENABLE_RELEASE_VERSIONS`

This flag controls whether the Release Versions page (`/all-status`) is included in the build.

### Behavior:
- **Development (local testing)**: Defaults to `true` - both pages are available for easy testing
- **Production (deployment)**: Must be explicitly set to `true` - defaults to email-only if not set

### Values:
- `true` - Both Email Sender and Release Versions pages are available
- `false` - Only Email Sender page is available
- Unset in production - Only Email Sender page (default for production)
- Unset in development - Both pages available (default for development)

## Local Development

For local testing, **both pages are enabled by default**. You don't need to set anything - just run:

```bash
cd client
npm start
```

Both Email Sender (`/`) and Release Versions (`/all-status`) will be available.

To test email-only mode locally, create a `.env` file in the `client/` directory:
```bash
REACT_APP_ENABLE_RELEASE_VERSIONS=false
```

## Deployment Options

### Option 1: Email Sender Only (Default for Production)

This is the standard deployment that includes only the Email Sender functionality.

**Build Command:**
```bash
cd client
npm run build:email-only
```

**Or set environment variable:**
```bash
REACT_APP_ENABLE_RELEASE_VERSIONS=false npm run build
```

**What's included:**
- Email Sender page (`/`)
- Authentication
- JIRA integration for email sending
- **NOT included:** Release Versions page

### Option 2: Full Deployment (Both Pages)

This deployment includes both Email Sender and Release Versions pages.

**Build Command:**
```bash
cd client
npm run build:full
```

**Or set environment variable:**
```bash
REACT_APP_ENABLE_RELEASE_VERSIONS=true npm run build
```

**What's included:**
- Email Sender page (`/`)
- Release Versions page (`/all-status`) - only accessible to `namratha.singh`
- Authentication
- JIRA integration for both pages

## Using Environment Files

You can create environment files in the `client/` directory:

### `.env.production` (Email Sender Only)
```bash
REACT_APP_ENABLE_RELEASE_VERSIONS=false
```

### `.env.production.full` (Both Pages)
```bash
REACT_APP_ENABLE_RELEASE_VERSIONS=true
```

Then copy the appropriate file before building:
```bash
# For email-only deployment
cp .env.production.email-only .env.production
npm run build

# For full deployment
cp .env.production.full .env.production
npm run build
```

## Deployment Script Usage

The `deploy.sh` script respects the `ENABLE_RELEASE_VERSIONS` environment variable:

```bash
# Deploy Email Sender only (default)
sudo ./deploy.sh

# Deploy with Release Versions enabled
sudo ENABLE_RELEASE_VERSIONS=true ./deploy.sh
```

## Verification

After deployment, verify which version is running:

1. **Email Sender Only:**
   - Navigate to the application
   - You should only see "Email Sender" in the navigation
   - Accessing `/all-status` will redirect to `/`

2. **Full Deployment:**
   - Navigate to the application
   - If logged in as `namratha.singh`, you should see both "Email Sender" and "Release Versions" links
   - Both pages should be accessible

## Hard Refresh Fix

The authentication state is now initialized immediately from localStorage, so hard refresh (CMD+SHIFT+R) will maintain the current route instead of redirecting to `/`.

## Notes

- The feature flag is evaluated at **build time**, not runtime
- To change the feature flag, you must rebuild the application
- The Release Versions page requires `namratha.singh` authentication even when enabled
- All dependencies are installed regardless of the feature flag (code is tree-shaken during build)

