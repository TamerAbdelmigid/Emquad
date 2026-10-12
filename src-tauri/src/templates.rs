//! Built-in starting points for a new project.

pub const NAMES: [&str; 4] = ["article", "report", "exam", "letter"];

pub fn files(template: &str, title: &str) -> Vec<(&'static str, String)> {
    let body = match template {
        "report" => REPORT,
        "exam" => EXAM,
        "letter" => LETTER,
        _ => ARTICLE,
    };
    vec![("main.tex", body.replace("{{title}}", title))]
}

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
