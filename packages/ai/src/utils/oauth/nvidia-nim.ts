/**
 * NVIDIA NIM OAuth-like flow (manual API key entry)
 * Uses OAuth interface but just prompts for API key
 */

import type { Api, Model } from "../../types.js";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "./types.js";

type NvidiaNimCredentials = OAuthCredentials & {
	baseUrl?: string;
};

const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";

interface NIMModelInfo {
	id: string;
	object: string;
	created: number;
	owned_by: string;
	root?: string;
	parent?: string;
	max_model_len?: number;
	permission?: unknown[];
}

interface NIMModelsResponse {
	object: string;
	data: NIMModelInfo[];
}

/**
 * Login with NVIDIA NIM (manual API key entry)
 */
export async function loginNvidiaNim(options: {
	onPrompt: (prompt: { message: string; placeholder?: string; allowEmpty?: boolean }) => Promise<string>;
	onProgress?: (message: string) => void;
	signal?: AbortSignal;
}): Promise<OAuthCredentials> {
	options.onProgress?.("Enter your NVIDIA NIM API credentials...");

	// Prompt for API key
	const apiKey = await options.onPrompt({
		message: "Enter your NVIDIA NIM API key (nvapi-...):",
		placeholder: "nvapi-...",
		allowEmpty: false,
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	if (!apiKey.trim()) {
		throw new Error("API key is required");
	}

	// Prompt for custom base URL (optional)
	const baseUrlInput = await options.onPrompt({
		message: "Custom API base URL (leave empty for default):",
		placeholder: DEFAULT_BASE_URL,
		allowEmpty: true,
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const baseUrl = baseUrlInput.trim() || DEFAULT_BASE_URL;

	// Validate URL format
	try {
		new URL(baseUrl);
	} catch {
		throw new Error("Invalid base URL format");
	}

	options.onProgress?.("Credentials saved successfully.");

	// Return credentials (no refresh needed, expires never)
	return {
		refresh: "manual",
		access: apiKey.trim(),
		expires: Infinity,
		baseUrl,
	};
}

/**
 * Refresh NVIDIA NIM token (no-op, just returns same credentials)
 */
export async function refreshNvidiaNimToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
	// NVIDIA NIM API keys don't expire, just return the same credentials
	return credentials;
}

/**
 * Scan models from NVIDIA NIM API
 */
export async function scanNvidiaNimModels(credentials: OAuthCredentials): Promise<Model<Api>[]> {
	const creds = credentials as NvidiaNimCredentials;
	const baseUrl = creds.baseUrl || DEFAULT_BASE_URL;

	// Remove /v1 suffix if present to get base URL for /v1/models
	const apiBase = baseUrl.replace(/\/v1\/?$/, "");

	const response = await fetch(`${apiBase}/v1/models`, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${creds.access}`,
			"Content-Type": "application/json",
		},
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch models from NVIDIA NIM: ${response.status} ${response.statusText}`);
	}

	const data = (await response.json()) as NIMModelsResponse;

	return data.data.map((model) => {
		const contextWindow = model.max_model_len || 8192;
		const maxTokens = Math.min(contextWindow, 4096);

		return {
			id: model.id,
			name: model.id,
			api: "openai-completions" as Api,
			provider: "nvidia-nim",
			baseUrl: baseUrl,
			reasoning: false,
			input: ["text"],
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow,
			maxTokens,
		};
	});
}

export const nvidiaNimOAuthProvider: OAuthProviderInterface = {
	id: "nvidia-nim",
	name: "NVIDIA NIM",

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		return loginNvidiaNim({
			onPrompt: callbacks.onPrompt,
			onProgress: callbacks.onProgress,
			signal: callbacks.signal,
		});
	},

	async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
		return refreshNvidiaNimToken(credentials);
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},

	modifyModels(models: Model<Api>[], credentials: OAuthCredentials): Model<Api>[] {
		const creds = credentials as NvidiaNimCredentials;
		const baseUrl = creds.baseUrl || DEFAULT_BASE_URL;
		return models.map((m) => (m.provider === "nvidia-nim" ? { ...m, baseUrl } : m));
	},

	async scanModels(credentials: OAuthCredentials): Promise<Model<Api>[]> {
		return scanNvidiaNimModels(credentials);
	},
};
