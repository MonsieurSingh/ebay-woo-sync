import dotenv from "dotenv";
dotenv.config();

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

function isRetriableError(err) {
	const status = err.response?.status;
	return status >= 500 || status === 429;
}

function logError(label, attempt, tries, err) {
	const status = err.response?.status;
	const data = err.response?.data;
	console.error(
		`❌ ${label} failed (attempt ${attempt}/${tries})`,
		status || "",
		data || err.message
	);
}

function logRetry(label, attempt, tries, wait, err) {
	const status = err.response?.status;
	const data = err.response?.data;
	console.warn(
		`⚠️  ${label} retrying after ${wait}ms (attempt ${attempt}/${tries})`,
		status,
		data?.errors?.[0]?.message || ""
	);
}

export async function withRetries(fn, { tries = 5, label = "request" } = {}) {
	let attempt = 0;
	let wait = 800;
	while (attempt < tries) {
		try {
			return await fn();
		} catch (err) {
			attempt++;
			if (!isRetriableError(err) || attempt >= tries) {
				logError(label, attempt, tries, err);
				throw err;
			}
			logRetry(label, attempt, tries, wait, err);
			await sleep(wait);
			wait = Math.min(wait * 2, 8000);
		}
	}
}
