# Bible reading plan

Use `/bible today` in a configured server or a bot DM. Replies are private. The first use starts your personal plan at reading 1; progress follows your Discord user across servers and DMs.

The plan covers all 1,189 chapters of the 66-book Bible in 365 readings of three or four chapters. It reads Matthew through Revelation, then Genesis through Malachi. The embed contains passage references only, with reading number and backlog in the footer.

**Complete** records the passage and advances one reading. Run `/bible today` again to continue or catch up. **Abandon** dismisses the card without completing or skipping anything. The next request returns the same passage. Older cards cannot complete a passage twice; abandoning also invalidates other copies of that card.

Readings are never tied to preset dates. Backlog counts missed calendar days since you started, using the host timezone captured at plan start. For example, if you complete reading 1 on your first day and return on day 4, reading 2 appears with **2 behind**. Today's pending reading is not counted as overdue. Reading ahead is allowed. Backlog stops growing after the 365-reading target.

`/bible history` lists completed passages and completion dates, newest first, 20 per page. Use `/bible history page:2` for older entries. History does not start a plan. State is saved atomically in ignored `data/bible.json` and survives restarts. Abandon does not reset the plan or erase history.

The Commands admin section can disable Bible. Sync registers the command in configured servers and bot DMs.
