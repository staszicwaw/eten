import { MessageEmbed, Snowflake, TextChannel, MessageOptions } from "discord.js";
import config from "../config.json";
// import util from "util";
import { client } from "../index";
import * as bets from "./bets";
import LibrusClient from "./librus-api";
import * as librusApiTypes from "./librus-api/librus-api-types";

interface IRoleRegexes {
	boldRegex: RegExp;
	roleRegex: RegExp;
	roleId: Snowflake;
}

interface IChannels {
	channel: TextChannel;
	knownNotices: Map<string, Snowflake>;
	rolesRegexArr: IRoleRegexes[];
}
const noticeListenerChannels: IChannels[] = [];
let librusClient: LibrusClient;

function isPlanChangeNotice(title: string): boolean {
	let flag = false;
	const titleLower = title.toLowerCase();
	const searchInterests: string[] = ["zmiany w planie", "poniedziałek", "wtorek", "środa", "czwartek", "piątek"];
	for (const searchString of searchInterests) {
		if (titleLower.search(searchString) !== -1) {
			flag = true;
			break;
		}
	}
	return flag;
}

async function fetchNewSchoolNotices(): Promise<void> {
	try {
		const pushChanges = await librusClient.getPushChanges();
		const pushChangesToDelete: number[] = [];
		for (const update of pushChanges.Changes) {
			// Get the notice if the element is of type 'SchoolNotices'
			pushChangesToDelete.push(update.Id);
			if (update.Resource?.Type === "SchoolNotices") {
				const librusResponse = await librusClient.librusRequest(update.Resource.Url, {}, "json") as librusApiTypes.APISchoolNotice;
				// Handle blocked SchoolNotices
				if ("Code" in librusResponse) {
					console.error(`${update.Resource.Id} - has Code:`.yellow);
					console.error(librusResponse);
					continue;
				}

				let changeType = "YOU SHOULDN'T BE ABLE TO SEE THIS";
				if (update.Type === "Add")
					changeType = "Nowe ogłoszenie";
				else if (update.Type === "Edit")
					changeType = "Najnowsza zmiana ogłoszenia";
				const baseMessageText = librusResponse.SchoolNotice.Content;

				for (const listener of noticeListenerChannels) {
					let messageText = baseMessageText;
					let taggers = "";
					if (isPlanChangeNotice(librusResponse.SchoolNotice.Subject) && listener.rolesRegexArr.length > 0) {
						for (const roleData of listener.rolesRegexArr) {
							if (roleData.boldRegex.test(messageText))
								taggers = taggers.concat(`<@&${roleData.roleId}>`);
							messageText = messageText.replace(roleData.boldRegex, "**$&**");
							messageText = messageText.replace(roleData.roleRegex, `<@&${roleData.roleId}> $&`);
						}
					}
					const embed = new MessageEmbed()
						.setColor("#D3A5FF")
						.setAuthor({
							name: `📣 ${changeType} w Librusie`
						})
						.setTitle(`**__${librusResponse.SchoolNotice.Subject}__**`)
						.setDescription(messageText.substring(0, 6000));
					if (listener.knownNotices.has(librusResponse.SchoolNotice.Id)) {
						const messageId = listener.knownNotices.get(librusResponse.SchoolNotice.Id);
						await (await listener.channel.messages.fetch(messageId)).edit({ content: taggers, embeds: [embed] });
						await listener.channel.send({
							reply: { messageReference: messageId, failIfNotExists: false },
							content: "Zmieniono ogłoszenie ^"
						});
					}
					else {
						const messagePayload: MessageOptions = { embeds: [embed] };
						if (taggers != "")
							messagePayload.content = taggers;
						const message = await listener.channel.send(messagePayload);
						listener.knownNotices.set(librusResponse.SchoolNotice.Id, message.id);
					}
				}
				console.log(`${librusResponse.SchoolNotice.Id}  --- Sent!`.green);
				// Do zmiany?
				if (isPlanChangeNotice(librusResponse.SchoolNotice.Subject)) {
					if (update.Type === "Add") {
						const date = new Date("1970-01-01 " + update.AddDate.split(" ")[1]);
						await bets.addTime(new Date(Date.now()));
						await bets.check(date);
					}
				}
			}
			else if (update.Resource?.Type === "Calendars/TeacherFreeDays") {
				const teacherFreeDay = (await librusClient.librusRequest(update.Resource.Url, {}, "json") as librusApiTypes.APICalendarsTeacherFreeDay).TeacherFreeDay;
				const teacher = (await librusClient.librusRequest(teacherFreeDay.Teacher.Url, {}, "json") as librusApiTypes.APIUser).User;
				let changeType = "YOU SHOULDN'T BE ABLE TO SEE THIS";
				if (update.Type === "Add")
					changeType = "Dodano";
				else if (update.Type === "Edit")
					changeType = "Zmieniono";
				const embed = new MessageEmbed()
					.setColor("#E56390")
					.setTitle(`${changeType} nieobecność nauczyciela`)
					.setDescription(
						`${teacher.FirstName} ${teacher.LastName}${update.extraData == null ? "" : (update.extraData.length > 0 ? `\n${update.extraData}` : "")}`.replace(/\t/g, "")
					)
					.setFields([
						{ name: "Od:", value: teacherFreeDay.DateFrom },
						{ name: "Do:", value: teacherFreeDay.DateTo }
					])
					.setFooter({ text: `Dodano: ${update.AddDate}` });
				for (const listener of noticeListenerChannels) {
					await listener.channel.send({ embeds: [embed] });
					console.log(`${update.Resource.Url}  --- Sent!`.green);
				}
			}
			else if (update.Resource?.Type === "Calendars/Substitutions") {
				const substitution = (await librusClient.librusRequest(update.Resource.Url, {}, "json") as librusApiTypes.APICalendarsSubstitution).Substitution;
				// TODO: Caching
				const orgSubject = (await librusClient.librusRequest(substitution.OrgSubject.Url, {}, "json") as librusApiTypes.APISubject).Subject;
				const orgTeacher = (await librusClient.librusRequest(substitution.OrgTeacher.Url, {}, "json") as librusApiTypes.APIUser).User;
				let newSubject = null;
				if ("Subject" in substitution)
					newSubject = (await librusClient.librusRequest(substitution.Subject.Url, {}, "json") as librusApiTypes.APISubject).Subject;
				let newTeacher = null;
				if ("Teacher" in substitution)
					newTeacher = (await librusClient.librusRequest(substitution.Teacher.Url, {}, "json") as librusApiTypes.APIUser).User;
				let changeType = "YOU SHOULDN'T BE ABLE TO SEE THIS";
				if (substitution.IsShifted)
					changeType = "Przesunięto zajęcia";
				else if (substitution.IsCancelled)
					changeType = "Odwołano zajęcia";
				else if (update.Type === "Add")
					changeType = "Dodano zastępstwo";
				else if (update.Type === "Edit")
					changeType = "Zmieniono zastępstwo";
				let lessonNo = substitution.OrgLessonNo;
				if ("LessonNo" in substitution) {
					if (substitution.OrgLessonNo !== substitution.LessonNo)
						lessonNo = `${substitution.OrgLessonNo} ➡️ ${substitution.LessonNo}`;
				}
				let subject = orgSubject.Name;
				if (newSubject != null) {
					if (orgSubject.Id !== newSubject.Id)
						subject = `${orgSubject.Name} ➡️ ${newSubject.Name}`;
				}
				let teacher = `${orgTeacher.FirstName} ${orgTeacher.LastName}`;
				if (newTeacher != null) {
					if (orgTeacher.Id !== newTeacher.Id)
						teacher = `${orgTeacher.FirstName} ${orgTeacher.LastName} ➡️ ${newTeacher.FirstName} ${newTeacher.LastName}`;
				}
				let date = substitution.OrgDate;
				if ("Date" in substitution) {
					if (substitution.OrgDate !== substitution.Date)
						date = `${substitution.OrgDate} ➡️ ${substitution.Date}`;
				}
				const embed = new MessageEmbed()
					.setColor("#9B3089")
					.setTitle(changeType)
					.setFields([
						{ name: "Nr Lekcji:", value: lessonNo },
						{ name: "Przedmiot:", value: subject },
						{ name: "Nauczyciel:", value: teacher },
						{ name: "Data i czas:", value: date }
					])
					.setFooter({
						text: `Dodano: ${update.AddDate}`
					});
				if (update.extraData?.length > 0)
					embed.setDescription(update.extraData);
				for (const listener of noticeListenerChannels) {
					// Temporary
					if (listener.channel.id === "884370476128944148") {
						await listener.channel.send({ content: "<@&885211432025731092>", embeds: [embed] });
						console.log(`${update.Resource.Url}  --- Sent!`.green);
					}
				}
			}
			else {
				console.log(`Skipping ${update.Resource.Url}`.bgMagenta.white);
			}
		}
		// do the DELETE(s) only once everything else succeeded
		await librusClient.deletePushChanges(pushChangesToDelete);
	}
	catch (error) {
		console.error("Something in updating notices failed:".bgRed.white);
		console.error(error);
		console.error("Retrying fetchNewSchoolNotices() in 2 mins.".bgRed.white);
		const failDelayTimeMs = 2 * 60 * 1000;
		setTimeout(fetchNewSchoolNotices, (failDelayTimeMs));
		return;
	}
	const maxDelayTime = 5 * 60;
	const minDelayTime = 4 * 60;
	setTimeout(fetchNewSchoolNotices, ((Math.round(Math.random() * (maxDelayTime - minDelayTime) + minDelayTime)) * 1000));
}

async function prepareTrackedChannelData(): Promise<void> {
	const classRoleRegex = /^([1-3])([A-Ia-i])(3|4)?$/;
	const classGroupRoleRegex = /^([1-3])([A-Ia-i])( - gr\. p\. .*)$/;
	for (const channelConfig of config.librusNoticeChannels) {
		const channel = await client.channels.fetch(channelConfig.channel);
		if (channel == null) {
			console.log(`${channelConfig.channel} - channel fetch() returned null!!!`.white.bgRed);
			continue;
		}
		if (!channel.isText || channel.type !== "GUILD_TEXT") {
			console.log(`${channel.id} is not a valid guild text channel!!!`.white.bgRed);
			continue;
		}
		channel as TextChannel;
		const rolesRegexArr: IRoleRegexes[] = [];
		if (channelConfig.roles) {
			const guildRoles = await (await client.guilds.fetch(channelConfig.guild)).roles.fetch();
			// Hack na grupy - grupowe role muszą być przed
			// zwykłymi klasowymi inaczej się będzie źle tagowało prawdopodobnie
			for (const role of guildRoles) {
				// Check if a role is a class role (judged from name)
				if (classGroupRoleRegex.test(role[1].name)) {
					// Create the beautifully looking regex
					const res = classGroupRoleRegex.exec(role[1].name);
					if (res == null)
						throw new Error("RegEx result is null");
					const classYear = res[1];
					const classLetter = res[2];
					rolesRegexArr.push({
						boldRegex: new RegExp(
							`^${classYear}${classLetter}${res[3]}`, "gm"
						),
						roleRegex: new RegExp(
							`\\*\\*${classYear}${classLetter}${res[3]}\\*\\*`, "gm"
						),
						roleId: role[1].id
					});
				}
			}
			//
			for (const role of guildRoles) {
				// Check if a role is a class role (judged from name)
				if (classRoleRegex.test(role[1].name)) {
					// Create the beautifully looking regex
					const res = classRoleRegex.exec(role[1].name);
					if (res == null)
						throw new Error("RegEx result is null");
					const classYear = res[1];
					let years = "4";
					let badYears = "3";
					let letterForSuffix = res[2].toUpperCase();
					let letterForNoSuffix = res[2];
					if (res[2].toUpperCase() === res[2]) {
						years = "3";
						badYears = "4";
						letterForSuffix = res[2].toLowerCase();
						letterForNoSuffix = res[2];
					}
					rolesRegexArr.push({
						boldRegex: new RegExp(
							`^((?:${classYear}[A-Ia-i]*[${letterForNoSuffix}][A-Ia-i]*${years}?(?!${badYears}))|(?:${classYear}[A-Ia-i]*[${letterForSuffix}][A-Ia-i]*${years}))`, "gm"
						),
						roleRegex: new RegExp(
							`\\*\\*((?:${classYear}[A-Ia-i]*[${letterForNoSuffix}][A-Ia-i]*${years}?(?!${badYears}))|(?:${classYear}[A-Ia-i]*[${letterForSuffix}][A-Ia-i]*${years}))\\*\\*`, "gm"
						),
						roleId: role[1].id
					});
				}
			}
		}
		noticeListenerChannels.push({
			channel: channel,
			rolesRegexArr: rolesRegexArr,
			knownNotices: new Map()
		});
	}
	// console.debug(util.inspect(noticeListenerChannels, false, null, true));
}

export default async function initLibrusManager() {
	librusClient = new LibrusClient();
	await librusClient.login(config.librusLogin, config.librusPass);
	librusClient.pushDevice = parseInt(config.pushDevice);
	await prepareTrackedChannelData();
	setTimeout(fetchNewSchoolNotices, 2000);
}
