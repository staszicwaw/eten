'use strict'

import { Message, Snowflake } from "discord.js"

const canvas = require('canvas')
const fs = require('fs')

export enum EStatkiCellState {
	NOT_SHOT = 0,
	MISS = 1,
	HIT = 2
}

export enum EStatkiGameState {
	PREPLANNING = 0,
	INGAME = 1,
	GAMEOVER = 2
}

export enum EStatkiShipOrientation {
	NORTH = 0,
	SOUTH = 1,
	WEST = 2,
	EAST = 3
}

export enum EStatkiMoveAction {
	UP_LEFT = 0,
	UP = 1,
	UP_RIGHT = 2,
	LEFT = 3,
	RIGHT = 4,
	DOWN_LEFT = 5,
	DOWN = 6,
	DOWN_RIGHT = 7,
	ROTATE_LEFT = 8,
	ROTATE_RIGHT = 9,
	PLACE = 10
}

interface IChallengeData {
	userId: Snowflake
	time: number
	message: Message
}

interface IShip {
	placed: boolean,
	initialSize: number
	sizeLeft: number
	x: number
	y: number
	orientation: EStatkiShipOrientation
}

export interface IShipsCollection {
	// Despite shipId being an int, we use string for future JSON ease of use?
	[shipId: string]: IShip
}

export interface ICellState {
	shot: EStatkiCellState
	ship: null|string
}

export interface IPlayerGameData {
	id: Snowflake
	ephemeralMessageId: Snowflake|null
	shipsLeft: number
	ships: IShipsCollection
	selectedShip: string|null
	board: Array<Array<ICellState>>
	shotsHistory?: Array<
		{
			x: number
			y: number
			hit: EStatkiCellState
		}
	>,
}

export interface IGameData {
	state: EStatkiGameState
	turn: Snowflake
	players: {
		[player: Snowflake]: IPlayerGameData
	}
}

interface IStatkiStats {
	wins: number
	losses: number
	forfeits: number // Used for shaming forfeits lol
	hits: number	//
	misses: number	// Used for accuracy
	shipsSunk: number
	shipsLost: number
	topHitStreak: number // Top streak of consecutive hits
	hitHeatMap: Array<Array<number>> // counting where the player shot, used for generating heatmaps of favorite shot spots
	shipHeatMap: Array<Array<number>> // when a ship is in a cell, ++, used for generating heatmaps of favorite ship spots
}

export class StatkiManager {
	/**
	 * Pending challenges Map
	 * Maps discord userId to challenge data
	 */
	pendingChallengesMap: Map<Snowflake, IChallengeData>
	/**
	 * Map discord userId to GameId (discord's MessageID of the game)
	 */
	userGamesMap: Map<Snowflake, Snowflake>
	/**
	 * Map GameId (messageId of the game) to the actual game data
	 */
	gameDataMap: Map<Snowflake, IGameData>
	/**
	 * Map discord userId to Per-user Stats
	 */
	userStatsMap: Map<Snowflake, IStatkiStats>
	constructor() {
		this.pendingChallengesMap = new Map()
		this.userGamesMap = new Map()
		this.gameDataMap = new Map()
		this.userStatsMap = new Map()
	}
	createTemplateCanvas() {
		const canvasWidth = 660, canvasHeight = 660
		const canvasObj = canvas.createCanvas(canvasWidth, canvasHeight)
		const ctx = canvasObj.getContext('2d')
		ctx.font = 'bold 40px Bahnschrift'
		ctx.textAlign = 'center'
		// Comment out for discord?
		// ctx.fillStyle = '#36393F'
		// ctx.fillRect(0, 0, canvasWidth, canvasHeight)
		//
		ctx.fillStyle = 'white'
		ctx.lineWidth = 2
		let x = 60
		let y = 60
		for (let i = 1; i <= 10; i++) {
			// Row
			ctx.beginPath()
			ctx.moveTo(0, y)
			ctx.lineTo(canvasWidth, y)
			ctx.stroke()
			// Column
			ctx.beginPath()
			ctx.moveTo(x, 0)
			ctx.lineTo(x, canvasHeight)
			ctx.stroke()
			y += 60
			x += 60
		}
		x = 29
		y = 105
		for (let i = 'A'.charCodeAt(0); i <= 'J'.charCodeAt(0); i++) {
			ctx.fillText(String.fromCharCode(i), x, y)
			y += 60
		}
		x = 90
		y = 45
		for (let i = 1; i <= 10; i++) {
			ctx.fillText(i, x, y)
			x += 60
		}
		return canvasObj
	}
	async renderGame(userId: Snowflake, ships: boolean): Promise<string> {
		console.time('statki_board_render')
		const currentCanvas = this.createTemplateCanvas()
		const ctx = currentCanvas.getContext('2d')
		if (ships) {
			// Ship rendering here first to be below shots!
		}
		const game = this.gameDataMap.get(this.userGamesMap.get(userId))
		for (let x = 0; x < 10; x++) {
			for (let y = 0; y < 10; y++) {
				if (game.players[userId].board[x][y].shot === EStatkiCellState.MISS) {
					ctx.beginPath()
					ctx.arc(90 + (x * 60), 90 + (y * 60), 24, 0, 2 * Math.PI)
					ctx.fillStyle = 'red'
					ctx.fill()
					ctx.lineWidth = 4
					ctx.strokeStyle = 'darkred'
					ctx.stroke()
				}
				else if (game.players[userId].board[x][y].shot === EStatkiCellState.HIT) {
					ctx.beginPath()
					ctx.arc(90 + (x * 60), 90 + (y * 60), 24, 0, 2 * Math.PI)
					ctx.fillStyle = 'gray'
					ctx.fill()
					ctx.lineWidth = 4
					ctx.strokeStyle = 'lightgray'
					ctx.stroke()
				}
			}
		}
		console.timeEnd('statki_board_render')
		return new Promise((resolve, reject) => {
			// Reject if we don't handle within 10s
			setTimeout(reject, 10000)
			const out = fs.createWriteStream(`${__dirname}}/../data/statki/${userId}.jpg`)
			const stream = currentCanvas.createPNGStream()
			stream.pipe(out)
			out.on('finish', () => {
				resolve(`${__dirname}/../data/statki/${userId}.jpg`)
			})
			out.on('error', (error: Error) => {
				reject(error)
			})
		})
	}
}

export const statkiManager = new StatkiManager()