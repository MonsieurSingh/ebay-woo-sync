require("dotenv").config();
const axios = require("axios");

async function refreshEbayToken() {
	const url =
		process.env.EBAY_ENV === "sandbox"
			? "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
			: "https://api.ebay.com/identity/v1/oauth2/token";

	const auth = Buffer.from(
		`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
	).toString("base64");

	const params = new URLSearchParams();
	params.append("grant_type", "refresh_token");
	params.append("refresh_token", process.env.EBAY_REFRESH_TOKEN);
	params.append(
		"scope",
		"https://api.ebay.com/oauth/api_scope/sell.inventory"
	);

	const resp = await axios.post(url, params.toString(), {
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Basic ${auth}`,
		},
	});

	return resp.data.access_token;
}

async function getUserTradingAPI(accessToken) {
	const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
  <GetUserRequest xmlns="urn:ebay:apis:eBLBaseComponents">
    <RequesterCredentials>
      <eBayAuthToken></eBayAuthToken>
    </RequesterCredentials>
  </GetUserRequest>`;

	try {
		const response = await axios.post(
			"https://api.ebay.com/ws/api.dll",
			xmlBody,
			{
				headers: {
					"X-EBAY-API-CALL-NAME": "GetUser",
					"X-EBAY-API-SITEID": "0",
					"X-EBAY-API-COMPATIBILITY-LEVEL": "967",
					"Content-Type": "text/xml",
					Authorization: `Bearer ${accessToken}`,
				},
			}
		);

		console.log("GetUser Response XML:", response.data);
	} catch (err) {
		console.error("GetUser failed:", err.response?.data || err.message);
	}
}

(async () => {
	const token = await refreshEbayToken();
	console.log("✅ Got eBay Access Token:", token.substring(0, 20) + "...");
	await getUserTradingAPI(token);
})();
