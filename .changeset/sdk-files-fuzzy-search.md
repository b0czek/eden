---
"@edenapp/sdk": minor
"@edenapp/types": minor
"@edenapp/files-core": patch
---

Files address bar search finds files and folders at any depth with case-insensitive fuzzy matching, and shows the best and nearest matches first. Results update while the search continues, with the number of searched items. Choosing a file result opens its folder with the file selected.

**Breaking:** `fs/search` is now a stream command. It sends the best results so far and the number of searched entries until the search completes, instead of one result array. `limit` accepts at most 1000.
