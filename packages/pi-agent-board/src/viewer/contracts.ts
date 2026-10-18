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
	status: ThreadStatus;
	summarized: boolean;
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
	status: ThreadStatus;
	summary: DiscussionSummary | null;
	root: Post | null;
	replies: Post[];
	nextCursor: string | null;
}

export type ThreadStatus = "open" | "completed" | "abandoned";

export interface DiscussionSummary {
	text: string;
	createdAt: string;
	throughMessageId: string;
	hasNewerPosts: boolean;
	provider: string;
	model: string;
	reasoning: string;
}
