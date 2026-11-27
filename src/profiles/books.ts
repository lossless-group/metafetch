// The Books profile: a book's ISBNs, publisher, year, and its Open Library,
// Goodreads, and Google Books pages, looked up by title and first author.
// "Fetch book reference details for frontmatter" uses it on any note; a
// books.md in the profiles folder (which "Create example frontmatter profile"
// writes) takes its place, so the fields can be edited in the vault.

export const BOOKS_PROFILE_FILENAME = 'books.md';

export const BOOKS_PROFILE = `---
title: Books
applies-to-paths:
  - "Sources/Books/**"
description: A book's ISBNs, publisher, year, and its Open Library, Goodreads, and Google Books pages, looked up by title and first author.
---

# Books

Run **Metafetch: Fetch book reference details for frontmatter** on any book note, or **Fill frontmatter from folder profile** on a note under \`Sources/Books/\`. A note doesn't need a \`url\`: Metafetch looks the book up by its \`title\` and first \`book_authors\` entry, and fills the fields below that are still empty. Fields that already hold a value, under their own name or an alias, are left alone.

How a book is matched:

1. **Open Library** (no key) is searched for the title and first author. The title is searched without any subtitle run on after a colon or a spaced dash. A result counts only when its title matches, ignoring case and punctuation. If no result matches, nothing is written.
2. ISBN-13, ISBN-10, publisher, and place come from the one edition Open Library ranks best for that search, so they describe the same printing. That edition isn't always the one in the note's \`publisher\`; check the ISBN when the printing matters.
3. When the exact search finds nothing, a looser one (**Open Library (loose search)**) tolerates spelling and name variants. Its ISBN may come from any printing, and it fills no publisher.
4. \`goodreads_url\` is written only when Open Library holds a Goodreads ID for the book. It is never guessed, and never asked of a model.
   \`cover_image\` is likewise written only when Open Library holds a cover for the book, as a link to that cover on covers.openlibrary.org.
5. **Google Books** needs an API key (Metafetch settings → Google Books). Without one, \`google_books_url\` is reported as not found and everything else still fills from Open Library.

These fields are the raw material for an AMA citation: author, title, subtitle, edition, place, publisher, year.

\`\`\`metafetch-profile
fields:
  isbn_13:
    from: [open-library, open-library-loose, google-books]
    value: isbn_13
    aliases: [isbn]
  isbn_10:
    from: [open-library, open-library-loose, google-books]
    value: isbn_10
  subtitle:
    from: [open-library, open-library-loose, google-books]
    value: subtitle
  book_authors:
    from: [open-library, open-library-loose, google-books]
    value: authors
  publisher:
    from: [open-library, google-books]
    value: publisher
  publisher_city:
    from: [open-library]
    value: publish_place
  year_first_published:
    from: [open-library, open-library-loose]
    value: first_publish_year
  open_library_url:
    from: [open-library, open-library-loose]
    value: work_key
    format: "https://openlibrary.org{{value}}"
  goodreads_url:
    from: [open-library, open-library-loose]
    value: goodreads_id
    format: "https://www.goodreads.com/book/show/{{value}}"
  cover_image:
    from: [open-library, open-library-loose]
    value: cover_id
    format: "https://covers.openlibrary.org/b/id/{{value}}-L.jpg"
  google_books_url:
    from: [google-books]
    value: google_books_url
\`\`\`
`;
