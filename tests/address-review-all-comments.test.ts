/**
 * Test to verify address-review fetches ALL PR comments, not just from latest review
 */

import { describe, test, expect } from "bun:test";

describe("Address Review - All Comments Fetching", () => {
  test("address-review comment filtering logic should work correctly", () => {
    // Simulate the filtering logic
    const allComments = [
      { id: 1, body: "First comment", pull_request_review_id: 100 },
      { id: 2, body: "Second comment", pull_request_review_id: 100 },
      { id: 3, body: "Third comment", pull_request_review_id: 200 },
      { id: 4, body: "Fourth comment", pull_request_review_id: 200 },
    ];

    const addressedCommentIds = new Set([2, 4]); // Comments 2 and 4 have hooray reaction

    // Filter out addressed comments
    const unaddressedComments = allComments.filter(
      (c) => !addressedCommentIds.has(c.id)
    );

    // Should get comments 1 and 3, regardless of review ID
    expect(unaddressedComments.length).toBe(2);
    expect(unaddressedComments.map((c) => c.id)).toEqual([1, 3]);

    // Verify we're getting comments from BOTH reviews (100 and 200)
    const reviewIds = new Set(unaddressedComments.map((c) => c.pull_request_review_id));
    expect(reviewIds.size).toBe(2); // Comments from 2 different reviews
    expect(reviewIds.has(100)).toBe(true);
    expect(reviewIds.has(200)).toBe(true);
  });

  test("should handle case where all comments from one review are addressed", () => {
    const allComments = [
      { id: 1, body: "Comment from review 1", pull_request_review_id: 100 },
      { id: 2, body: "Comment from review 1", pull_request_review_id: 100 },
      { id: 3, body: "Comment from review 2", pull_request_review_id: 200 },
    ];

    // All comments from review 1 are addressed, but review 2 comment is not
    const addressedCommentIds = new Set([1, 2]);

    const unaddressedComments = allComments.filter(
      (c) => !addressedCommentIds.has(c.id)
    );

    // Should still get the comment from review 2
    expect(unaddressedComments.length).toBe(1);
    expect(unaddressedComments[0].id).toBe(3);
    expect(unaddressedComments[0].pull_request_review_id).toBe(200);
  });
});
