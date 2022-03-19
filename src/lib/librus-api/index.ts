import nodeFetch, { RequestInit } from "node-fetch";
import "colors";
import { LibrusError } from "./errors/libruserror";
import fetchCookie from "fetch-cookie";
import * as librusApiTypes from "./librus-api-types";
const fetch = fetchCookie(nodeFetch, new fetchCookie.toughCookie.CookieJar());

type RequestResponseType =
	| "text"
	| "json"
	| "raw"

/**
 * Class for easy interaction with the mobile Librus web API
 * @default
 * @class
 */
export default class LibrusClient {
	bearerToken: string;
	pushDevice: number;
	/**
	 * Create a new Librus API client
	 * TODO: Getters/setters? Or maybe a better option to initialize them?
	 * @constructor
	 */
	constructor() {
		this.bearerToken = "";
		this.pushDevice = 0;
	}

	/**
	 * Login to Librus using your mobile app credentials. Mandatory to run before using anything else.
	 * @async
	 * @param username Your Librus app username (This is NOT a Synergia login)
	 * @param password Your Librus app password
	 */
	async login(username: string, password: string): Promise<void> {
		// Get csrf-token from <meta> tag for following requests
		const result = await this.librusRequest("https://portal.librus.pl/", {}, "text") as string;
		const csrfTokenRegexResult = /<meta name="csrf-token" content="(.*)">/g.exec(result);
		if (csrfTokenRegexResult == null)
			throw new LibrusError("No csrf-token meta tag in <head> of main site");
		const csrfToken = csrfTokenRegexResult[1];

		// Login
		// Response gives necessary cookies, saved automatically by LibrusClient.rawRequest
		await this.librusRequest("https://portal.librus.pl/rodzina/login/action", {
			method: "POST",
			body: JSON.stringify({
				email: username,
				password: password
			}),
			headers: {
				"Content-Type": "application/json",
				"X-CSRF-TOKEN": csrfToken
			}
		});

		// Get the accessToken
		const result2 = await this.librusRequest("https://portal.librus.pl/api/v3/SynergiaAccounts", {}, "json") as librusApiTypes.APISynergiaAccounts;
		if (result2.accounts[0]?.accessToken == null)
			throw new LibrusError("SynergiaAccounts endpoint returned no accessToken for account");
		this.bearerToken = result2.accounts[0].accessToken;
		console.log("Login OK".bgGreen);
		return;
	}

	/**
	 * Uses existing cached cookies instead of credentials to try and get bearer token.
	 * Use only if you're using cookies through constructor or session is expired and you don't want to execute login() function.
	 * @async
	 */
	async initWithCookie(): Promise<void> {
		// Get the newer accessToken
		const result = await this.librusRequest("https://portal.librus.pl/api/v3/SynergiaAccounts", {}, "json") as librusApiTypes.APISynergiaAccounts;
		if (result.accounts[0]?.accessToken == null)
			throw new LibrusError("GET SynergiaAccounts returned unexpected JSON format");
		this.bearerToken = result.accounts[0].accessToken;
		return;
	}

	/**
	 * Creates a request to Librus API using provided link, method, body and returns the JSON data sent back
	 * @async
	 * @param url API endpoit URL
	 * @param options Additional options - passed on to node-fetch call
	 * @param type What data should the request return: "json", "text", "raw"
	 */
	async librusRequest(url: string, options?: RequestInit, type: RequestResponseType = "raw"): Promise<unknown> {
		// Merge default request options with user request options - this can be done much better...
		let requestOptions: RequestInit = {
			method: "GET",
			headers: {
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.114 Safari/537.36",
				gzip: "true",
				Authorization: ((this.bearerToken !== "") ? `Bearer ${this.bearerToken}` : ""),
				redirect: "manual"
			}
		};
		if (options) {
			if ("headers" in options)
				requestOptions.headers = { ...requestOptions.headers, ...options.headers };
			requestOptions = { ...requestOptions, ...options };
		}

		console.debug(`${requestOptions.method} ${url}`.bgMagenta.white);
		const result = await fetch(url, requestOptions);
		// Handle librus timeouts somewhere here
		// Handle token expiry somewhere here
		if (!result.ok)
			throw new LibrusError(`${result.status} ${result.statusText}`);

		if (type === "json")
			return await result.json();
		else if (type === "raw")
			return result;
		return await result.text();
	}

	/**
	 * Requests (and automatically saves internally for future use) a new pushDevice ID from librus
	 * @async
	 * @returns Optionally return the new pushDevice ID
	 */
	async newPushDevice(): Promise<number> {
		const jsonResult = await this.librusRequest("https://api.librus.pl/3.0/ChangeRegister", {
			method: "POST",
			body: JSON.stringify({
				sendPush: 0,
				appVersion: "5.9.0"
			})
		}, "json") as librusApiTypes.PostAPIChangeRegister;
		// this.pushDevice = jsonResult.ChangeRegister.Id;
		if (jsonResult.ChangeRegister?.Id == null)
			throw new LibrusError("POST ChangeRegister returned unexpected JSON format");
		return this.pushDevice = jsonResult.ChangeRegister.Id;
	}

	/**
	 * Get changes since last check given our pushDevice
	 * @async
	 * @returns {JSON} Response if OK in member (of type array) "Changes" of returned object.
	 */
	async getPushChanges(): Promise<librusApiTypes.APIPushChanges> {
		const resultJson = await this.librusRequest(`https://api.librus.pl/3.0/PushChanges?pushDevice=${this.pushDevice}`, {}, "json") as librusApiTypes.APIPushChanges;
		if (!("Changes" in resultJson))
			throw new LibrusError("No \"Changes\" array in received PushChanges JSON");
		const pushChanges: number[] = [];
		if (resultJson.Changes.length > 0) {
			for (const element of resultJson.Changes) {
				if (!pushChanges.includes(element.Id))
					pushChanges.push(element.Id);
			}
		}
		await this.deletePushChanges(pushChanges);
		return resultJson;
	}

	/**
	 * Creates one or more DELETE request(s) for all elements from the last getPushChanges
	 * UNTESTED
	 * @async
	 */
	private async deletePushChanges(lastPushChanges: number[]): Promise<void> {
		if (!lastPushChanges.length)
			return;
		while (lastPushChanges.length) {
			const delChanges = lastPushChanges.splice(0, 30).join(",");
			await this.librusRequest(`https://api.librus.pl/3.0/PushChanges/${delChanges}?pushDevice=${this.pushDevice}`, {
				method: "DELETE"
			});
		}
		return;
	}
}