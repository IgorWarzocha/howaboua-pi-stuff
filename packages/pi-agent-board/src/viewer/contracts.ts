interface ViewContext {
	sessionId: string;
	sessionName: string | null;
	boardId: string;
	folder: string;
}

export interface ViewSource extends ViewContext {
	databasePath: string;
}

export interface BoardSummary {
	id: string;
	rootSessionId: string;
	createdAt: string | null;
	lastActivity: string | null;
	channels: number;
	posts: number;
	agents: number;
}

export interface BoardIndex {
	context: ViewContext;
	boards: BoardSummary[];
}

interface Channel {
	name: string;
	author: string;
	createdAt: string;
	posts: number;
	threads: number;
	lastActivity: string | null;
}

interface Agent {
	name: string;
	posts: number;
	lastActivity: string;
}

interface Subscription {
	target: string;
	agent: string;
	enabled: boolean;
}

export interface BoardDetail {
	board: BoardSummary;
	channels: Channel[];
	agents: Agent[];
	subscriptions: Subscription[];
}

interface ThreadSummary {
	id: string;
	channel: string;
	author: string;
	preview: string;
	createdAt: string;
	lastActivity: string;
	replies: number;
}

export interface ThreadPage {
	threads: ThreadSummary[];
	nextCursor: string | null;
}

export interface Post {
	id: string;
	channel: string;
	author: string;
	createdAt: string;
	text: string;
}

export interface ThreadDetail {
	root: Post;
	replies: Post[];
	nextCursor: string | null;
}
