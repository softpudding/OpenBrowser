# CLA Setup Guide

This document explains how to set up CLA (Contributor License Agreement) automation for the OpenBrowser project.

## Automated CLA Signing with CLA Assistant

We recommend using [CLA Assistant](https://cla-assistant.io/) for automated CLA signing. CLA Assistant is a free, open-source tool that integrates with GitHub and handles the CLA signing process automatically.

### Setup Steps

#### 1. Create a CLA Repository

CLA Assistant requires a repository to store signed CLAs. You can use:
- A separate repository (recommended for organizations)
- The same repository as your project (simpler for smaller projects)

For OpenBrowser, we store CLAs in `.github/cla-signatures/` directory.

#### 2. Install CLA Assistant GitHub App

1. Go to [CLA Assistant](https://cla-assistant.io/)
2. Click "Sign in with GitHub"
3. Authorize CLA Assistant to access your repositories
4. Install the CLA Assistant GitHub App on your repository

#### 3. Configure CLA Assistant

In the CLA Assistant dashboard:

1. **Select Repository**: Choose `OpenBrowser` (or your fork)
2. **CLA Document URL**: Set to your CLA documents:
   - Individual: `https://github.com/softpudding/OpenBrowser/blob/main/.github/CLA_INDIVIDUAL.md`
   - Corporate: `https://github.com/softpudding/OpenBrowser/blob/main/.github/CLA_CORPORATE.md`
3. **CLA Storage**:
   - Store signed CLAs in the repository
   - Path: `.github/cla-signatures/individual/` for individual CLAs
   - Path: `.github/cla-signatures/corporate/` for corporate CLAs
4. **Whitelist**: Add any users who don't need to sign (bots, team members who signed already)

#### 4. Test the Setup

1. Create a test PR from a different account
2. Verify that CLA Assistant bot comments on the PR
3. Test signing the CLA through the provided link
4. Verify the CLA signature file is created in the repository

## Alternative: CLA Assistant Lite (Self-Hosted)

For more control, you can self-host CLA Assistant Lite:

```bash
# Clone CLA Assistant
git clone https://github.com/cla-assistant/cla-assistant.git
cd cla-assistant

# Configure environment variables
cp .env.example .env
# Edit .env with your GitHub App credentials

# Deploy to your preferred platform
# (Heroku, Docker, Kubernetes, etc.)
```

## Alternative: Probot CLA

Another option is [probot-cla](https://github.com/probot/probot-cla), a simpler GitHub App:

1. Deploy the probot-cla app
2. Configure it for your repository
3. It will check for CLA signatures on every PR

## CLA Signing Workflow

### For Individual Contributors

1. Contributor opens a Pull Request
2. CLA Assistant checks if contributor has signed CLA
3. If not signed, bot comments with signing instructions
4. Contributor clicks link and signs CLA (OAuth with GitHub)
5. Signature is stored in repository
6. CLA check passes, PR can be merged

### For Corporate Contributors

1. Contributor opens a Pull Request
2. CLA Assistant detects organization affiliation
3. Bot requests Corporate CLA signature
4. Authorized representative signs on behalf of organization
5. Organization's authorized contributors are whitelisted
6. Future PRs from authorized employees are automatically approved

## Manual CLA Signing (Fallback)

If contributors prefer not to use CLA Assistant, they can sign manually:

1. Fork the repository
2. Create signature file in `.github/cla-signatures/individual/` or `corporate/`
3. Submit a PR with the signature file
4. Maintainers merge the signature PR
5. Contributor can then submit their actual contribution

## Monitoring and Maintenance

- **Regular Audits**: Periodically review signed CLAs
- **Update CLA**: If CLA terms change, require re-signing
- **Revoke Access**: Remove CLA signatures if contributors become ineligible

## Troubleshooting

### CLA Assistant not commenting on PRs
- Check if the GitHub App is installed correctly
- Verify repository permissions
- Check CLA Assistant logs for errors

### Contributor cannot sign CLA
- Ensure they have a GitHub account
- Check if they're already whitelisted
- Try manual signing as fallback

### Corporate CLA issues
- Verify the signer is authorized
- Check organization name matches
- Ensure GitHub organization is linked

## Resources

- [CLA Assistant Documentation](https://github.com/cla-assistant/cla-assistant)
- [GitHub CLA Best Practices](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/adding-a-contributor-license-agreement-for-your-repository)
- [Apache CLA Templates](https://www.apache.org/licenses/)