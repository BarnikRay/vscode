/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as es from 'event-stream';
import * as util from 'gulp-util';
import * as File from 'vinyl';
import * as appInsights from 'applicationinsights';

class Entry {
	constructor(readonly name: string, public totalCount: number, public totalSize: number) { }

	toString(pretty?: boolean): string {
		if (!pretty) {
			if (this.totalCount === 1) {
				return `${this.name}: ${this.totalSize} bytes`;
			} else {
				return `${this.name}: ${this.totalCount} files with ${this.totalSize} bytes`;
			}
		} else {
			if (this.totalCount === 1) {
				return `Stats for '${util.colors.grey(this.name)}': ${Math.round(this.totalSize / 1204)}KB`;

			} else {
				let count = this.totalCount < 100
					? util.colors.green(this.totalCount.toString())
					: util.colors.red(this.totalCount.toString());

				return `Stats for '${util.colors.grey(this.name)}': ${count} files, ${Math.round(this.totalSize / 1204)}KB`;
			}
		}
	}
}

const _entries = new Map<string, Entry>();

export function createStatsStream(group: string, log?: boolean): es.ThroughStream {

	const entry = new Entry(group, 0, 0);
	_entries.set(entry.name, entry);

	return es.through(function (data) {
		let file = data as File;
		if (typeof file.path === 'string') {
			entry.totalCount += 1;
			if (Buffer.isBuffer(file.contents)) {
				entry.totalSize += file.contents.length;
			} else if (file.stat && typeof file.stat.size === 'number') {
				entry.totalSize += file.stat.size;
			} else {
				// funky file...
			}
		}
		this.emit('data', data);
	}, function () {
		if (log) {
			if (entry.totalCount === 1) {
				util.log(`Stats for '${util.colors.grey(entry.name)}': ${Math.round(entry.totalSize / 1204)}KB`);

			} else {
				let count = entry.totalCount < 100
					? util.colors.green(entry.totalCount.toString())
					: util.colors.red(entry.totalCount.toString());

				util.log(`Stats for '${util.colors.grey(entry.name)}': ${count} files, ${Math.round(entry.totalSize / 1204)}KB`);
			}
		}

		this.emit('end');
	});
}

export function submitAllStats(productJson: any): Promise<void> {

	let sorted: Entry[] = [];
	// move entries for single files to the front
	_entries.forEach(value => {
		if (value.totalCount === 1) {
			sorted.unshift(value);
		} else {
			sorted.push(value);
		}
	});

	// print to console
	for (const entry of sorted) {
		console.log(entry.toString(true));
	}

	// send data as telementry event when the
	// product is configured to send telemetry
	if (!productJson || !productJson.aiConfig || typeof productJson.aiConfig.asimovKey !== 'string') {
		return Promise.resolve();
	}

	return new Promise(resolve => {

		const properties = { size: {}, count: {} };
		for (const entry of sorted) {
			properties.size[entry.name] = entry.totalSize;
			properties.count[entry.name] = entry.totalCount;
		}

		appInsights.setup(productJson.aiConfig.asimovKey)
			.setAutoCollectConsole(false)
			.setAutoCollectExceptions(false)
			.setAutoCollectPerformance(false)
			.setAutoCollectRequests(false)
			.start();

		const client = appInsights.getClient(productJson.aiConfig.asimovKey);
		client.config.endpointUrl = 'https://vortex.data.microsoft.com/collect/v1';

		/* __GDPR__
			"monacoworkbench/packagemetrics" : {
				"size" : {"classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true }
				"count" : {"classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true }
			}
		*/
		client.trackEvent(`monacoworkbench/packagemetrics`, properties);
		client.sendPendingData(() => resolve());
	});

}
