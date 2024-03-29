import Board from "../../lib/pilkarzyki/4players";
import Discord, { ButtonInteraction, Client, CommandInteraction, Message, MessageActionRow, MessageButtonStyleResolvable, TextChannel } from "discord.js";
import { APIMessage, ThreadAutoArchiveDuration } from "discord-api-types";
import fs from "fs";
import { SlashCommandBuilder, SlashCommandUserOption } from "@discordjs/builders";
import config from "../../config.json";
import { IRanking } from "../../lib/types";
const Elo = require("elo-rating");

interface IUids {
	[uid: string]: number
}

interface IBoards {
	[id: string]: Board
}

interface IAccept {
	uids: Array<string>;
	usernames: Array<string>;
	accepted: Array<string>;
	message?: APIMessage | Message<boolean>;
}

interface IAccepts {
	[id: string]: IAccept
}

const uids: IUids = {};
const boards: IBoards = {};
let gameID = 1;
let newAcceptID = 1;
const accepts: IAccepts = {};

function getButtons(id: number): Array<MessageActionRow> {
	let indexes;
	try {
		indexes = boards[id].possibleMovesIndexes();
	}
	catch (error) {
		console.error("Couldnt get possibleMovesIndexes. Boards probably doesnt exist");
		return;
	}
	let style: MessageButtonStyleResolvable;
	if (boards[id].turn % 2 == 0)
		style = "PRIMARY";
	else
		style = "DANGER";

	const row1 = new Discord.MessageActionRow()
		.addComponents(
			new Discord.MessageButton()
				.setCustomId("teampilkarzyki#0")
				.setLabel("↖")
				.setStyle(style)
				.setDisabled(!indexes.includes(0)),
			new Discord.MessageButton()
				.setCustomId("teampilkarzyki#1")
				.setLabel("⬆")
				.setStyle(style)
				.setDisabled(!indexes.includes(1)),
			new Discord.MessageButton()
				.setCustomId("teampilkarzyki#2")
				.setLabel("↗")
				.setStyle(style)
				.setDisabled(!indexes.includes(2))
		);
	const row2 = new Discord.MessageActionRow()
		.addComponents(
			new Discord.MessageButton()
				.setCustomId("teampilkarzyki#3")
				.setLabel("⬅")
				.setStyle(style)
				.setDisabled(!indexes.includes(3)),
			new Discord.MessageButton()
				.setCustomId("teampilkarzyki#disabled")
				.setLabel("xd")
				.setStyle(style)
				.setDisabled(true),
			new Discord.MessageButton()
				.setCustomId("teampilkarzyki#4")
				.setLabel("➡")
				.setStyle(style)
				.setDisabled(!indexes.includes(4))
		);
	const row3 = new Discord.MessageActionRow()
		.addComponents(
			new Discord.MessageButton()
				.setCustomId("teampilkarzyki#5")
				.setLabel("↙")
				.setStyle(style)
				.setDisabled(!indexes.includes(5)),
			new Discord.MessageButton()
				.setCustomId("teampilkarzyki#6")
				.setLabel("⬇")
				.setStyle(style)
				.setDisabled(!indexes.includes(6)),
			new Discord.MessageButton()
				.setCustomId("teampilkarzyki#7")
				.setLabel("↘")
				.setStyle(style)
				.setDisabled(!indexes.includes(7))
		);
	const row4 = new Discord.MessageActionRow()
		.addComponents(
			new Discord.MessageButton()
				.setCustomId("teampilkarzyki#remis")
				.setLabel("Remis")
				.setStyle("SECONDARY"),
			new Discord.MessageButton()
				.setCustomId("teampilkarzyki#surrender")
				.setLabel("Poddaj się")
				.setStyle("SECONDARY")
		);

	return [row1, row2, row3, row4];
}

export const data = new SlashCommandBuilder()
	.setName("teampilkarzyki")
	.setDescription("Piłkarzyki drużynowe")
	.addUserOption(
		new SlashCommandUserOption()
			.setName("gracz2")
			.setDescription("Drugi gracz (razem z tobą w drużynie)")
			.setRequired(true)
	)
	.addUserOption(
		new SlashCommandUserOption()
			.setName("gracz3")
			.setDescription("Trzeci gracz (w przeciwnej drużynie)")
			.setRequired(true)
	)
	.addUserOption(
		new SlashCommandUserOption()
			.setName("gracz4")
			.setDescription("Czwarty gracz (w przeciwnej drużynie)")
			.setRequired(true)
	);

export async function execute(interaction: CommandInteraction) {
	if (interaction.isButton()) {
		interaction.customId = interaction.customId.slice(interaction.customId.indexOf("#") + 1);

		if (interaction.customId.startsWith("accept")) {
			acceptManager(interaction);
			return;
		}

		if (uids[interaction.user.id] == undefined)
			return;

		if (interaction.customId == "surrender") {
			if (await surrenderManager(interaction))
				return;
		}
		else if (interaction.customId == "remis") {
			if (await drawManager(interaction))
				return;
		}
		else {
			if (await buttonManager(interaction)) // shutup funcking eslint
				return;
		}

		let msg = "", components;
		const bid = uids[interaction.user.id];
		if (boards[bid].win == -1) {
			components = true;
			msg = `Tura: <@${boards[bid].turnUID}>`;
			if (boards[bid].remis.length > 0)
				msg += ` (${boards[bid].remis.length}/4 osoby poprosiły o remis)`;
			for (let i = 0; i <= 1; i++)
				if (boards[bid].surrender[i].length == 1)
					msg += ` (<@${boards[bid].surrender[i]}> głosuje za poddaniem się)`;
		}
		else {
			components = false;
			msg = `<@${boards[bid].uids[boards[bid].win]}> i <@${boards[bid].uids[boards[bid].win + 2]}> wygrali!`;
		}

		sendBoard(bid, interaction.client, interaction.message, msg, components);

		if (boards[bid].win != -1) {
			const winners = boards[bid].win;
			const losers = (winners + 1) % 2;

			const wholeRanking: IRanking = JSON.parse(fs.readFileSync("./data/ranking.json", "utf-8"));
			const ranking = wholeRanking.teampilkarzyki;
			const guids = boards[bid].uids;

			const tempuids = [...guids];
			let uidsString = "";
			for (const uid of tempuids.sort())
				uidsString += uid + "#";
			uidsString = uidsString.substring(0, uidsString.length - 1);

			if (wholeRanking.najdluzszagrateampilkarzyki[uidsString] === undefined)
				wholeRanking.najdluzszagrateampilkarzyki[uidsString] = 0;
			wholeRanking.najdluzszagrateampilkarzyki[uidsString] = Math.max(boards[bid].totalMoves, wholeRanking.najdluzszagrateampilkarzyki[uidsString]);

			const losersAverage = (ranking[guids[losers]].rating + ranking[guids[losers + 2]].rating) / 2;
			const winnersAverage = (ranking[guids[winners]].rating + ranking[guids[winners + 2]].rating) / 2;

			ranking[guids[winners]].rating = Elo.calculate(ranking[guids[winners]].rating, losersAverage, true).playerRating;
			ranking[guids[winners + 2]].rating = Elo.calculate(ranking[guids[winners + 2]].rating, losersAverage, true).playerRating;

			ranking[guids[losers]].rating = Elo.calculate(ranking[guids[losers]].rating, winnersAverage, false).playerRating;
			ranking[guids[losers + 2]].rating = Elo.calculate(ranking[guids[losers + 2]].rating, winnersAverage, false).playerRating;

			ranking[guids[losers]].lost++;
			ranking[guids[losers + 2]].lost++;
			ranking[guids[winners]].won++;
			ranking[guids[winners + 2]].won++;

			wholeRanking.teampilkarzyki = ranking;
			fs.writeFileSync("./data/ranking.json", JSON.stringify(wholeRanking));

			for (const uid of boards[bid].uids)
				delete uids[uid];
			delete boards[bid];
		}
		return;
	}
	else if (interaction.isCommand()) {
		const player1 = interaction.user;
		const player2 = interaction.options.getUser("gracz2");
		const player3 = interaction.options.getUser("gracz3");
		const player4 = interaction.options.getUser("gracz4");

		const guids = [player1.id, player3.id, player2.id, player4.id];
		const usernames = [player1.username, player3.username, player2.username, player4.username];

		if (uids[guids[0]]) {
			interaction.reply("Już grasz w grę");
			return;
		}
		for (let i = 1; i <= 3; i++) {
			if (uids[guids[i]]) {
				interaction.reply(`<@${guids[i]}> już gra w grę`);
				return;
			}
		}

		const check: { [uid: string]: boolean } = {};
		for (const uid of guids) {
			if (check[uid]) {
				interaction.reply("Osoby nie mogą się powtarzać");
				return;
			}
			check[uid] = true;
		}

		const wholeRanking: IRanking = JSON.parse(fs.readFileSync("./data/ranking.json", "utf-8"));
		const ranking = wholeRanking.teampilkarzyki;

		for (const uid of guids) {
			if (ranking[uid] === undefined)
				ranking[uid] = { lost: 0, won: 0, rating: 1500 };
		}

		wholeRanking.teampilkarzyki = ranking;
		fs.writeFileSync("./data/ranking.json", JSON.stringify(wholeRanking));

		const newAccept: IAccept = {
			usernames: usernames,
			uids: guids,
			accepted: []
		};
		const buttonsID = newAcceptID;
		newAcceptID++;

		const row = new Discord.MessageActionRow()
			.addComponents(
				new Discord.MessageButton()
					.setLabel("Tak")
					.setCustomId("teampilkarzyki#acceptYes#" + buttonsID)
					.setStyle("PRIMARY"),
				new Discord.MessageButton()
					.setLabel("Nie")
					.setCustomId("teampilkarzyki#acceptNo#" + buttonsID)
					.setStyle("PRIMARY")
			);
		const msg = `Drużynowe piłkarzyki: <@${guids[0]}> i <@${guids[2]}> przeciwko <@${guids[1]}> i <${guids[3]}>`;
		const message = await interaction.reply({ content: msg, components: [row], fetchReply: true });
		newAccept.message = message;

		accepts[buttonsID] = newAccept;
	}
}

async function buttonManager(interaction: ButtonInteraction): Promise<boolean> {
	const bid = uids[interaction.user.id];

	if (interaction.user.id != boards[bid].turnUID)
		return true;

	const indexes = boards[bid].possibleMovesIndexes();
	if (!indexes.includes(parseInt(interaction.customId)))
		return true;

	boards[bid].currMoveLen++;
	if (!boards[bid].move(indexes.indexOf(parseInt(interaction.customId))))
		return true;

	if (boards[bid].turnUID != interaction.user.id) {
		boards[bid].longestMove[interaction.user.id] = Math.max(boards[bid].longestMove[interaction.user.id], boards[bid].currMoveLen);
		boards[bid].currMoveLen = 0;

		const ranking: IRanking = JSON.parse(fs.readFileSync("./data/ranking.json", "utf-8"));
		if (ranking.najdluzszyruch[interaction.user.id] == undefined)
			ranking.najdluzszyruch[interaction.user.id] = 0;
		ranking.najdluzszyruch[interaction.user.id] = Math.max(ranking.najdluzszyruch[interaction.user.id], boards[bid].longestMove[interaction.user.id]);
		fs.writeFileSync("./data/ranking.json", JSON.stringify(ranking));
	}

	return false;
}

async function drawManager(interaction: ButtonInteraction): Promise<boolean> {
	const bid = uids[interaction.user.id];
	if (boards[bid].remis.includes(interaction.user.id))
		return true;

	boards[bid].remis.push(interaction.user.id);
	if (boards[bid].remis.length == 4) {
		sendBoard(bid, interaction.client, interaction.message, "Remis", false);

		const wholeRanking: IRanking = JSON.parse(fs.readFileSync("./data/ranking.json", "utf-8"));
		const guids = boards[bid].uids;

		const tempuids = [...guids];
		let uidsString = "";
		for (const uid of tempuids.sort())
			uidsString += uid + "#";
		uidsString = uidsString.substring(0, uidsString.length - 1);

		if (wholeRanking.najdluzszagrateampilkarzyki[uidsString] === undefined)
			wholeRanking.najdluzszagrateampilkarzyki[uidsString] = 0;
		wholeRanking.najdluzszagrateampilkarzyki[uidsString] = Math.max(boards[bid].totalMoves, wholeRanking.najdluzszagrateampilkarzyki[uidsString]);
		fs.writeFileSync("./data/ranking.json", JSON.stringify(wholeRanking));

		for (const uid of boards[bid].uids)
			delete uids[uid];
		delete boards[bid];
		return true;
	}
	return false;
}

async function surrenderManager(interaction: ButtonInteraction): Promise<boolean> {
	const bid = uids[interaction.user.id];

	if (boards[bid].surrender[boards[bid].uids.indexOf(interaction.user.id) % 2].includes(interaction.user.id))
		return true;
	boards[bid].surrender[boards[bid].uids.indexOf(interaction.user.id) % 2].push(interaction.user.id);

	if (boards[bid].surrender[boards[bid].uids.indexOf(interaction.user.id) % 2].length == 2) {
		const losers = boards[bid].uids.indexOf(interaction.user.id) % 2;
		const winners = (losers + 1) % 2;

		sendBoard(bid, interaction.client, interaction.message, `<@${boards[bid].uids[losers]}> i <@${boards[bid].uids[losers + 2]}> poddali się`, false);

		const wholeRanking: IRanking = JSON.parse(fs.readFileSync("./data/ranking.json", "utf-8"));
		const ranking = wholeRanking.teampilkarzyki;
		const guids = boards[bid].uids;

		const tempuids = [...guids];
		let uidsString = "";
		for (const uid of tempuids.sort())
			uidsString += uid + "#";
		uidsString = uidsString.substring(0, uidsString.length - 1);

		if (wholeRanking.najdluzszagrateampilkarzyki[uidsString] == undefined)
			wholeRanking.najdluzszagrateampilkarzyki[uidsString] = 0;
		wholeRanking.najdluzszagrapilkarzyki[uidsString] = Math.max(wholeRanking.najdluzszagrapilkarzyki[uidsString], boards[bid].totalMoves);

		const losersAverage = (ranking[guids[losers]].rating + ranking[guids[losers + 2]].rating) / 2;
		const winnersAverage = (ranking[guids[winners]].rating + ranking[guids[winners + 2]].rating) / 2;
		ranking[guids[winners]].rating = Elo.calculate(ranking[guids[winners]].rating, losersAverage, true).playerRating;
		ranking[guids[winners + 2]].rating = Elo.calculate(ranking[guids[winners + 2]].rating, losersAverage, true).playerRating;

		ranking[guids[losers]].rating = Elo.calculate(ranking[guids[losers]].rating, winnersAverage, false).playerRating;
		ranking[guids[losers + 2]].rating = Elo.calculate(ranking[guids[losers + 2]].rating, winnersAverage, false).playerRating;

		ranking[guids[losers]].lost++;
		ranking[guids[losers + 2]].lost++;
		ranking[guids[winners]].won++;
		ranking[guids[winners + 2]].won++;

		wholeRanking.teampilkarzyki = ranking;
		fs.writeFileSync("./data/ranking.json", JSON.stringify(wholeRanking));

		for (const uid of boards[bid].uids)
			delete uids[uid];
		delete boards[bid];
		return true;
	}
	return false;
}

async function acceptManager(interaction: ButtonInteraction) {
	const bUids = interaction.customId.split("#");
	const acceptID = bUids[1];
	const accept = accepts[acceptID];

	if (!accept.uids.includes(interaction.user.id))
		return;

	if (interaction.customId.startsWith("acceptNo")) {
		(accept.message as Message).edit({
			content: `${interaction.user.username} nie zaakceptował gry`,
			components: []
		});
		delete accepts[acceptID];
		return;
	}
	else {
		if (accept.accepted.includes(interaction.user.id))
			return;
		accept.accepted.push(interaction.user.id);

		if (accept.accepted.length != 4) {
			const guids = accept.uids;
			const msg = `Drużynowe piłkarzyki: <@${guids[0]}> i <@${guids[2]}> przeciwko <@${guids[1]}> i <@${guids[3]}> (${accept.accepted.length}/4 osób zaakceptowało)`;
			const row = new Discord.MessageActionRow()
				.addComponents(
					new Discord.MessageButton()
						.setLabel("Tak")
						.setCustomId("teampilkarzyki#acceptYes#" + acceptID)
						.setStyle("PRIMARY"),
					new Discord.MessageButton()
						.setLabel("Nie")
						.setCustomId("teampilkarzyki#acceptNo#" + acceptID)
						.setStyle("DANGER")
				);
			interaction.update({ content: msg, components: [row] });
			return;
		}
		else {
			delete accepts[acceptID];

			for (const uid of accept.uids) {
				for (const [id, acc] of Object.entries(accepts)) {
					if (acc.uids.includes(uid)) {
						(acc.message as Message).edit({ content: acc.message.content, components: [] });
						delete accepts[id];
					}
				}
			}

			const gid = gameID;
			gameID++;
			for (const uid of accept.uids)
				uids[uid] = gid;

			boards[gid] = new Board(50, 50, 50, 3, accept.uids, accept.usernames, gid);
			sendBoard(gid, interaction.client, interaction.message, `Tura: <@${boards[gid].turnUID}>`);
		}
	}
}

async function sendBoard(id: number, client: Client, message: APIMessage | Message<boolean>, content: string, components = true, interaction: CommandInteraction = undefined) {
	try {
		boards[id].draw();
	}
	catch {
		console.error("Couldnt draw board (Probably doesnt exist)");
	}

	const attachment = new Discord.MessageAttachment(`./tmp/boardTeamPilkarzyki${id}.png`);
	const img = await (client.guilds.cache.get(config.junkChannel.guild).channels.cache.get(config.junkChannel.channel) as TextChannel).send({ files: [attachment] });
	content += `\n${img.attachments.first().url}`;
	const messagePayload = {
		content: content,
		components: (components ? getButtons(id) : [])
	};

	if (interaction)
		message = await interaction.editReply(messagePayload);
	else
		message = await (message as Message).edit(messagePayload);

	try {
		boards[id].message = (message as Message<boolean>);
	}
	catch (error) {
		console.error("Couldn't set boards[id].message (probably boards[id] doesnt exist)");
	}
}