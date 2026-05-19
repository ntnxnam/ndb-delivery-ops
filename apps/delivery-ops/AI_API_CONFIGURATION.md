# NAI API Key Configuration

The Team Executive Release Report system supports NAI API key management for generating executive reports.

## Features

- **Named API Keys**: Users can assign friendly names to their API keys
- **Secure Storage**: API keys and names stored locally in browser
- **Validation**: Real-time testing of API connectivity before saving
- **Key Management**: Easy clearing and updating of stored credentials

## Supported AI APIs

### 1. Nutanix NAI (Default)
- **Endpoint**: `https://dpro-nai.corp.p10y.ntnxdpro.com/enterpriseai/v1/chat/completions`
- **Model**: `eng-pool-05`
- **Use Case**: Internal Nutanix deployment

### 2. OpenAI
- **Endpoint**: `https://api.openai.com/v1/chat/completions`
- **Models**: `gpt-4`, `gpt-4-turbo`, `gpt-3.5-turbo`
- **API Key**: Obtain from https://platform.openai.com/

### 3. Anthropic Claude
- **Endpoint**: `https://api.anthropic.com/v1/messages`
- **Models**: `claude-3-opus`, `claude-3-sonnet`, `claude-3-haiku`
- **API Key**: Obtain from https://console.anthropic.com/

### 4. Custom/Self-Hosted APIs
- Any OpenAI-compatible endpoint
- Local LLM deployments (e.g., Ollama, LocalAI)
- Enterprise AI platforms

## Configuration Process

1. **Navigate to Release Trends Page**
2. **Click "🎯 Generate Executive Report"**
3. **Enter API Configuration** (if not already configured):
   - **Key Name** (optional): Friendly name for your API key (e.g., "My NAI Key", "Production Key")
   - **API Key** (required): Your NAI API key
4. **Test & Save**: System validates connectivity before storing
5. **Generate Report**: AI-powered Team Executive report is generated

## Security Notes

- API keys are stored locally in browser localStorage
- Keys are never sent to application servers
- Direct API calls are made from backend to AI service
- Clear configuration option available in modal

## Error Handling

- **Invalid Endpoint**: URL format validation
- **Network Issues**: Connectivity and timeout handling
- **Authentication**: API key validation with service
- **Rate Limits**: Proper error messaging for API limits

## Usage Tips

1. **Test Connection**: Always use "Test & Save" to validate setup
2. **Key Management**: Regularly rotate API keys for security
3. **Endpoint Selection**: Choose based on compliance and performance needs
4. **Fallback**: Keep Nutanix NAI as fallback for internal use

## Implementation Details

### Frontend (ReleaseTrendsPage.js)
- Enhanced modal with endpoint and key fields
- Client-side URL validation
- Secure localStorage management
- Error handling and user feedback

### Backend (server/routes/jira/index.js)
- `/validate-nai-key`: Tests API connectivity
- `/generate-ai-vp-report`: Uses configured endpoint
- URL validation and error handling
- Generic OpenAI-compatible request format

## Future Enhancements

- Model selection dropdown
- API usage analytics
- Multiple endpoint profiles
- Import/export configuration
- Team-level API configuration