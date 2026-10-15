//! Built-in starting points for a new project.

pub const NAMES: [&str; 5] = ["article", "report", "thesis", "exam", "letter"];

pub fn files(template: &str, title: &str) -> Vec<(&'static str, String)> {
    let body = match template {
        "report" => REPORT,
        "thesis" => THESIS,
        "exam" => EXAM,
        "letter" => LETTER,
        _ => ARTICLE,
    };
    let mut out = vec![("main.tex", body.replace("{{title}}", title))];
    if template == "thesis" {
        out.push(("references.bib", REFERENCES.to_string()));
    }
    out
}

/// A first reference, to show how one is written and cited.
pub const REFERENCES: &str =
    "% Your references. Each one has a key, here knuth1984, which \\cite{knuth1984}
% writes in the text. Add yours below, or copy them from a reference manager as BibTeX.

@book{knuth1984,
  author    = {Donald E. Knuth},
  title     = {The {\\TeX}book},
  publisher = {Addison-Wesley},
  year      = {1984},
}
";

const ARTICLE: &str = r"\documentclass[11pt]{article}
\usepackage{amsmath, amssymb}
\usepackage{graphicx}

\title{{{title}}}
\author{}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
A short summary of the paper.
\end{abstract}

\section{Introduction}
Start writing here.

\end{document}
";

const REPORT: &str = r"\documentclass[11pt]{report}
\usepackage{amsmath, amssymb}
\usepackage{graphicx}

\title{{{title}}}
\author{}
\date{\today}

\begin{document}
\maketitle
\tableofcontents

\chapter{Introduction}
Start writing here.

\end{document}
";

const THESIS: &str = r"\documentclass[12pt, a4paper]{report}
% The page: margins, and the spacing between lines (\onehalfspacing or \doublespacing).
\usepackage[margin=2.5cm]{geometry}
\usepackage{setspace}
\onehalfspacing
\usepackage{amsmath, amssymb}
\usepackage{graphicx}

\title{{{title}}}
\author{Your name}
\date{\today}

\begin{document}

\begin{titlepage}
  \centering
  \vspace*{3cm}
  {\Huge\bfseries {{title}}\par}
  \vspace{2cm}
  {\Large Your name\par}
  \vfill
  A thesis submitted for the degree of \ldots\par
  \vspace{1cm}
  {\large \today\par}
\end{titlepage}

\begin{abstract}
A short summary of the thesis: the question, how it was answered, and what was found.
\end{abstract}

\chapter*{Acknowledgements}
Thank the people who helped here.

\tableofcontents
\listoffigures
\listoftables

\chapter{Introduction}
Start writing here. A reference is cited like this~\cite{knuth1984}, and the list of
references at the end is made from \texttt{references.bib}.

\chapter{Literature review}

\chapter{Method}

\chapter{Results}

\chapter{Conclusion}

\bibliographystyle{plain}
\bibliography{references}

\end{document}
";

const EXAM: &str = r"\documentclass[11pt]{article}
\usepackage{amsmath, amssymb}
\usepackage{enumitem}
\usepackage[margin=2.5cm]{geometry}

\begin{document}

\begin{center}
{\Large \textbf{{{title}}}}\\[4pt]
Duration: 120 minutes \hfill Total: 40 marks
\end{center}
\hrule
\vspace{1em}

\noindent\textbf{Name:} \rule{6cm}{0.4pt} \hfill \textbf{Number:} \rule{4cm}{0.4pt}

\section*{Part 1: Short questions}
\begin{enumerate}[label=\arabic*.]
  \item First question. \hfill [5 marks]
  \item Second question. \hfill [5 marks]
\end{enumerate}

\end{document}
";

const LETTER: &str = r"\documentclass[11pt]{letter}
\signature{Your name}
\address{Your address}

\begin{document}
\begin{letter}{Recipient\\Their address}
\opening{Dear Sir or Madam,}

{{title}}

\closing{Yours faithfully,}
\end{letter}
\end{document}
";
