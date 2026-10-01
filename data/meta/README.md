# Episto meta-research export

Released under CC0 with each monthly build. Cite the build month: these files
change every month.

## Read this first: selection

Community flags are not a sample of research. They show what members chose to
check and what lottery panels upheld. Counts here say how often a problem was
*found and upheld*, not how common it is. Official notices (retractions,
expressions of concern) come from Retraction Watch and carry its own
selection. Prevalence needs a random sample: Episto projects draw one.

## Files

- **counts.csv**: one row per combination of source (community or notice),
  category, type, severity, status, domain and publication year, with the
  number of flags.
- **rounds.csv**: one row per decided round of a community flag, rejected
  ones included: category, type, field, round, trigger, panel size, the votes
  the round needed, the votes finding the flag holds, and the outcome. No
  member data: who sat and how each voted stay sealed.
- **logic.jsonl**: one line per community flag with a logic tree: the
  paper's DOI, the flag type, severity, status, and the steps. Steps are in
  the proposer's own words (claims paraphrased, at most 30 words, with
  where they are in the paper), never the paper's text:
  - `{"claim", "where", "rests_on"}`: what the paper claims, and on which
    evidence (numbers of the flag's evidence entries);
  - `{"cites", "for"}`: the claim rests on another paper (DOI);
  - `{"fails", "because"}`: the flag's failure, shown by which evidence;
  - `{"so"}`: what falls with it.
- **dependencies.csv**: paper-to-paper links: `citing_doi`, `cited_doi`,
  and `via`: `logic` (a flagged claim rests on the cited paper) or
  `references` (a reference list submitted to Episto cites a paper
  flagged Critical or Major). Reference lists are counted only when members
  submitted them; the checker collects nothing.
