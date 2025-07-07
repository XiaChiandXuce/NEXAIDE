// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// AI Chat View Provider
class AIChatViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'nexaide.chatView';
	private _view?: vscode.WebviewView;
	constructor(private readonly _extensionUri: vscode.Uri) {}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		token: vscode.CancellationToken
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Handle messages from the webview
		webviewView.webview.onDidReceiveMessage(
			async (data) => {
				switch (data.command) {
					case 'sendMessage':
						await this.handleAIMessage(data.message, data.model);
						break;
				}
			}
		);
	}

	private async handleAIMessage(message: string, model: string) {
		try {
			// Simulate AI response (replace with actual AI API call)
			await new Promise(resolve => setTimeout(resolve, 1000));
			
			const aiResponse = this.generateMockAIResponse(message);
			
			if (this._view) {
				this._view.webview.postMessage({
					command: 'addMessage',
					content: aiResponse
				});
			}
		} catch (error) {
			if (this._view) {
				this._view.webview.postMessage({
					command: 'error',
					content: 'Failed to get AI response. Please try again.'
				});
			}
		}
	}

	private generateMockAIResponse(message: string): string {
		// Mock AI responses based on message content
		const lowerMessage = message.toLowerCase();
		
		if (lowerMessage.includes('hello') || lowerMessage.includes('hi')) {
			return 'Hello! I\'m NEXAIDE, your AI programming assistant. How can I help you with your code today?';
		}
		
		if (lowerMessage.includes('javascript') || lowerMessage.includes('js')) {
			return 'I can help you with JavaScript! Here\'s a simple example:\n\n```javascript\nfunction greet(name) {\n    return `Hello, ${name}!`;\n}\n\nconsole.log(greet("World"));\n```\n\nWhat specific JavaScript topic would you like to explore?';
		}
		
		if (lowerMessage.includes('python')) {
			return 'Python is a great language! Here\'s a quick example:\n\n```python\ndef fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)\n\nprint(fibonacci(10))\n```\n\nWhat Python concept can I help you with?';
		}
		
		if (lowerMessage.includes('debug') || lowerMessage.includes('error')) {
			return 'I can help you debug your code! Please share:\n\n1. The error message you\'re seeing\n2. The relevant code snippet\n3. What you expected to happen\n\nThis will help me provide more targeted assistance.';
		}
		
		if (lowerMessage.includes('function') || lowerMessage.includes('method')) {
			return 'Functions are fundamental building blocks! Here are some best practices:\n\n• Use descriptive names\n• Keep functions small and focused\n• Handle edge cases\n• Add proper documentation\n\nWhat specific function-related question do you have?';
		}
		
		return `I understand you're asking about: "${message}"\n\nAs your AI programming assistant, I can help with:\n\n• Code generation and completion\n• Debugging and error fixing\n• Code review and optimization\n• Explaining programming concepts\n• Best practices and patterns\n\nCould you provide more specific details about what you'd like help with?`;
	}

	public clearChat() {
		if (this._view) {
			this._view.webview.postMessage({
				command: 'clearChat'
			});
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		// Read the HTML file
		const htmlPath = path.join(this._extensionUri.fsPath, 'src', 'chatView.html');
		return fs.readFileSync(htmlPath, 'utf8');
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "nexaide" is now active!');

	// Create the AI Chat View Provider
	const aiChatProvider = new AIChatViewProvider(context.extensionUri);

	// Register the webview view provider
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			AIChatViewProvider.viewType,
			aiChatProvider
		)
	);

	// Register commands
	const helloWorldCommand = vscode.commands.registerCommand('nexaide.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from NEXAIDE!');
	});

	const openChatCommand = vscode.commands.registerCommand('nexaide.openChat', () => {
		vscode.commands.executeCommand('nexaide.chatView.focus');
	});

	const clearChatCommand = vscode.commands.registerCommand('nexaide.clearChat', () => {
		aiChatProvider.clearChat();
	});

	context.subscriptions.push(helloWorldCommand, openChatCommand, clearChatCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {}
