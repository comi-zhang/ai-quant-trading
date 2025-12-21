CREATE TABLE `aiDecisions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`action` enum('buy','sell','hold') NOT NULL,
	`confidence` decimal(5,2),
	`reasoning` text,
	`fundamentalScore` decimal(5,2),
	`sentimentScore` decimal(5,2),
	`technicalScore` decimal(5,2),
	`fundamentalData` text,
	`sentimentData` text,
	`technicalData` text,
	`recommendedPrice` decimal(18,4),
	`recommendedQuantity` decimal(18,8),
	`executed` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `aiDecisions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `apiKeys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` varchar(50) NOT NULL,
	`keyName` varchar(100) NOT NULL,
	`keyValue` text NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `apiKeys_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`quantity` decimal(18,8) NOT NULL,
	`avgPrice` decimal(18,4) NOT NULL,
	`currentPrice` decimal(18,4),
	`marketValue` decimal(18,2),
	`unrealizedPnl` decimal(18,2),
	`unrealizedPnlPercent` decimal(10,4),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `positions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `riskConfig` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`maxPositionSize` decimal(18,2) NOT NULL,
	`maxTotalExposure` decimal(18,2) NOT NULL,
	`stopLossPercent` decimal(5,2) NOT NULL,
	`takeProfitPercent` decimal(5,2) NOT NULL,
	`maxDailyTrades` int NOT NULL,
	`enableAutoTrading` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `riskConfig_id` PRIMARY KEY(`id`),
	CONSTRAINT `riskConfig_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`side` enum('buy','sell') NOT NULL,
	`orderType` enum('market','limit') NOT NULL,
	`quantity` decimal(18,8) NOT NULL,
	`price` decimal(18,4) NOT NULL,
	`totalAmount` decimal(18,2) NOT NULL,
	`status` enum('pending','filled','partial','cancelled','rejected') NOT NULL DEFAULT 'pending',
	`orderId` varchar(100),
	`executedAt` timestamp,
	`aiDecisionId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `trades_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `watchlist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`name` text,
	`market` varchar(10) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `watchlist_id` PRIMARY KEY(`id`)
);
