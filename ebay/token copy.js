import axios from "axios";
import dotenv from "dotenv";
dotenv.config();
import { withRetries } from "../utils/retry.js";
import { EBAY_BASE } from "../utils/constants.js";

let appEbayAccessToken = null;
let appEbayAccessTokenExpiry = 0;
let ebayAccessToken = null;
let ebayAccessTokenExpiry = 0;

export async function refreshAppEbayToken() {
	const url = `${EBAY_BASE}/identity/v1/oauth2/token`;
	const auth = Buffer.from(
		`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
	).toString("base64");
	const params = new URLSearchParams();
	params.append("grant_type", "client_credentials");
	params.append("scope", ["https://api.ebay.com/oauth/api_scope"].join(" "));
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
	return appEbayAccessToken;
}

export async function getAppEbayToken() {
	if (!appEbayAccessToken || Date.now() > appEbayAccessTokenExpiry) {
		return await refreshAppEbayToken();
	}
	return appEbayAccessToken;
}

export async function refreshEbayToken() {
	const url = `${EBAY_BASE}/identity/v1/oauth2/token`;
	const auth = Buffer.from(
		`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
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
	return ebayAccessToken;
}

export async function getEbayToken() {
	if (!ebayAccessToken || Date.now() > ebayAccessTokenExpiry) {
		return await refreshEbayToken();
	}
	return ebayAccessToken;
}

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
