// token.js
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();
import { withRetries } from "../utils/retry.js";
import { EBAY_BASE } from "../utils/constants.js";

// --- your existing token storage + functions (slightly adapted) ---
let appEbayAccessToken = null;
let appEbayAccessTokenExpiry = 0;
let ebayAccessToken = null;
let ebayAccessTokenExpiry = 0;

// simple refresh locks (prevent concurrent refresh requests)
let appRefreshPromise = null;
let userRefreshPromise = null;

export async function refreshAppEbayToken() {
	console.log("Client ID:", process.env.EBAY_CLIENT_ID);
	console.log(
		"Client Secret:",
		process.env.EBAY_CLIENT_SECRET
			? "***" + process.env.EBAY_CLIENT_SECRET.slice(-4)
			: "MISSING"
	);
	console.log("EBAY_BASE:", EBAY_BASE);
	if (appRefreshPromise) return appRefreshPromise;
	appRefreshPromise = (async () => {
		const url = `${EBAY_BASE}/identity/v1/oauth2/token`;
		const auth = Buffer.from(
			encodeURIComponent(process.env.EBAY_CLIENT_ID) +
				":" +
				encodeURIComponent(process.env.EBAY_CLIENT_SECRET)
		).toString("base64");
		const params = new URLSearchParams();
		params.append("grant_type", "client_credentials");
		params.append(
			"scope",
			["https://api.ebay.com/oauth/api_scope"].join(" ")
		);
		const resp = await withRetries(
			() =>
				axios.post(url, params.toString(), {
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
						Authorization: `Basic ${auth}`,
					},
				}),
			{ label: "app-token" }
		);
		appEbayAccessToken = resp.data.access_token;
		appEbayAccessTokenExpiry =
			Date.now() + Math.max(resp.data.expires_in - 60, 1) * 1000;
		appRefreshPromise = null;
		return appEbayAccessToken;
	})();
	return appRefreshPromise;
}

export async function getAppEbayToken() {
	if (!appEbayAccessToken || Date.now() > appEbayAccessTokenExpiry) {
		return await refreshAppEbayToken();
	}
	return appEbayAccessToken;
}

export async function refreshEbayToken() {
	console.log("Client ID:", process.env.EBAY_CLIENT_ID);
	console.log(
		"Client Secret:",
		process.env.EBAY_CLIENT_SECRET
			? "***" + process.env.EBAY_CLIENT_SECRET.slice(-4)
			: "MISSING"
	);
	console.log("EBAY_BASE:", EBAY_BASE);
	if (userRefreshPromise) return userRefreshPromise;
	userRefreshPromise = (async () => {
		const url = `${EBAY_BASE}/identity/v1/oauth2/token`;
		const auth = Buffer.from(
			encodeURIComponent(process.env.EBAY_CLIENT_ID) +
				":" +
				encodeURIComponent(process.env.EBAY_CLIENT_SECRET)
		).toString("base64");
		const params = new URLSearchParams();
		params.append("grant_type", "refresh_token");
		params.append("refresh_token", process.env.EBAY_REFRESH_TOKEN);
		params.append(
			"scope",
			[
				"https://api.ebay.com/oauth/api_scope",
				"https://api.ebay.com/oauth/api_scope/sell.inventory",
				"https://api.ebay.com/oauth/api_scope/sell.account",
				"https://api.ebay.com/oauth/api_scope/sell.fulfillment",
				"https://api.ebay.com/oauth/api_scope/sell.marketing",
			].join(" ")
		);
		const resp = await withRetries(
			() =>
				axios.post(url, params.toString(), {
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
						Authorization: `Basic ${auth}`,
					},
				}),
			{ label: "ebay token" }
		);
		ebayAccessToken = resp.data.access_token;
		ebayAccessTokenExpiry =
			Date.now() + Math.max(resp.data.expires_in - 60, 1) * 1000;
		userRefreshPromise = null;
		return ebayAccessToken;
	})();
	return userRefreshPromise;
}

export async function getEbayToken() {
	if (!ebayAccessToken || Date.now() > ebayAccessTokenExpiry) {
		return await refreshEbayToken();
	}
	return ebayAccessToken;
}

// compatibility helpers if you still want to build header objects
export async function getUserAuthHeaders() {
	const token = await getEbayToken();
	return {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
		"Content-Language": "en-AU",
	};
}
export async function getAppAuthHeaders() {
	const token = await getAppEbayToken();
	return {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
		"Content-Language": "en-AU",
	};
}

export function createEbayClient({
	tokenType = "user",
	baseURL = EBAY_BASE,
} = {}) {
	const client = axios.create({ baseURL });

	// Set defaults
	client.defaults.headers.common["Accept"] = "application/json";
	client.defaults.headers.common["Content-Language"] = "en-AU";
	client.defaults.timeout = 15000;

	// Combined interceptor for token + logging
	client.interceptors.request.use(async (config) => {
		// Get token first
		if (tokenType === "app") {
			const t = await getAppEbayToken();
			config.headers.Authorization = `Bearer ${t}`;
		} else {
			const t = await getEbayToken();
			config.headers.Authorization = `Bearer ${t}`;
		}

		// Only set Content-Type for non-GET requests
		const method = config.method?.toLowerCase();
		if (method && ["post", "put", "patch"].includes(method)) {
			config.headers["Content-Type"] = "application/json";
		}

		// Log AFTER setting headers
		const fullUrl = config.url?.startsWith("http")
			? config.url
			: `${config.baseURL || ""}${config.url || ""}`;

		console.log(`[ebayApp] ${method?.toUpperCase()} ${fullUrl}`);
		console.log(
			`[ebayApp] Auth: ${config.headers.Authorization?.slice(0, 15)}...`
		);

		return config;
	});

	// Response interceptor
	client.interceptors.response.use(
		(res) => res,
		async (err) => {
			const original = err.config;
			const status = err.response?.status;

			// Only handle 401 errors
			if (status === 401 && !original._retried) {
				original._retried = true;
				try {
					const refreshedToken =
						tokenType === "app"
							? await refreshAppEbayToken()
							: await refreshEbayToken();

					original.headers.Authorization = `Bearer ${refreshedToken}`;
					return client(original);
				} catch (refreshErr) {
					console.error("Token refresh failed:", refreshErr.message);
				}
			}
			throw err;
		}
	);

	return client;
}
let _ebayUserClient = null;
let _ebayAppClient = null;

export function getEbayUserClient() {
	if (!_ebayUserClient)
		_ebayUserClient = createEbayClient({ tokenType: "user" });
	return _ebayUserClient;
}
export function getEbayAppClient() {
	if (!_ebayAppClient)
		_ebayAppClient = createEbayClient({ tokenType: "app" });
	return _ebayAppClient;
}
