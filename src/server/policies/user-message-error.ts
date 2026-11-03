/**
 * An error whose message is written for the person who caused it ("That address is already in use.") and is safe to show
 * as is. Any other thrown error reaches the user only as "Something went wrong".
 */
export class UserMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserMessageError";
  }
}
