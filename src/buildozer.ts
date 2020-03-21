// Wrapper around @bazel/buildozer with some convenience methods
import * as buildozer from '@bazel/buildozer';

// Create a "comment ..." command with necessary escaping
export function escapeComment(comment: string) {
    return comment.replace(/(\s)/g, '\\$1');
}

export type CommandBatch = buildozer.CommandBatch;
export const runWithOptions = buildozer.runWithOptions;
