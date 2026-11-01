---
title: "Uma crítica aos níveis de isolamento do ANSI SQL"
summary: O artigo mostra que as definições de níveis de isolamento do SQL-92, escritas como listas de anomalias proibidas, são ambíguas e incompletas, acrescenta novas anomalias como lost update e write skew e define o isolamento por snapshot.
researchArea: Bancos de dados
keywords: transações, níveis de isolamento, isolamento por snapshot, write skew, serializabilidade, controle de concorrência
version: 1.0
updatedAt: 2026-11-01
---

## Visão geral

Bancos de dados deixam muitas transações rodarem ao mesmo tempo, e os níveis de isolamento são a configuração que decide quanto uma transação pode ver das outras. Um nível mais baixo é mais rápido e permite resultados estranhos, e o mais alto, serializável, se comporta como se as transações rodassem uma depois da outra. As aplicações escolhem um nível por um nome do padrão SQL, como READ COMMITTED ou REPEATABLE READ.

Este artigo do SIGMOD 1995, de pesquisadores da Microsoft, da Sybase, de Berkeley e da UMass Boston, pergunta se esses nomes significam o que o padrão diz que significam. A resposta é que não, e que a forma como o padrão os define é parte da razão.

Vale conhecer antes: o que é uma transação, serializabilidade e controle de concorrência básico com locks (locks de leitura e escrita, two-phase locking). O artigo usa uma notação para históricos como `r1[x]` (a transação 1 lê x) e `w2[x]` (a transação 2 escreve x).

## Contribuição

- **Uma crítica à definição baseada em anomalias.** O SQL-92 define cada nível proibindo três fenômenos: Dirty Read, Non-repeatable Read e Phantom. Os autores mostram que as definições em inglês são ambíguas, que nem sua leitura mais ampla exclui todo comportamento anômalo, e que os níveis baseados em lock de produtos reais se comportam de modo diferente dos níveis ANSI de mesmo nome.
- **Novos fenômenos.** Dirty Write (P0), Lost Update (P4), Read Skew (A5A) e Write Skew (A5B), entre outros, dão uma escala mais fina.
- **Definições mais claras.** Uma leitura ampla dos fenômenos ANSI que coincide com os níveis por lock do trabalho anterior sobre "graus de consistência".
- **Isolamento por snapshot.** Um nível multiversão em que cada transação lê de um snapshot tirado no início e uma regra de first-committer-wins evita lost updates. O artigo o situa na hierarquia.
- Uma tabela que caracteriza os níveis usados por sistemas comerciais, como Cursor Stability e o Read Consistency da Oracle, pelas anomalias que permitem.

## Metodologia

É um artigo analítico, sem experimentos. Os autores definem fenômenos como padrões em um histórico de leituras e escritas e testam cada nível ANSI contra históricos concretos, mostrando exemplos que as definições estritas permitem mas que claramente quebram a integridade. Depois comparam implementações com locks em cada nível (a duração dos locks de leitura e escrita) com as definições por anomalias e situam cada nível em uma hierarquia segundo as anomalias que ele permite.

Para o isolamento por snapshot, argumentam mapeando históricos multiversão em históricos de versão única com o mesmo fluxo de dados, e dão um exemplo com restrição entre duas contas para mostrar que ele não é serializável.

## Resultados

Estas são as afirmações dos autores.

- As definições ANSI não proíbem dirty writes, e os três fenômenos do padrão não bastam para descrever nem o REPEATABLE READ por locks. É preciso uma leitura ampla para que os níveis coincidam com as definições por locks.
- O isolamento por snapshot evita dirty reads, lost updates e fuzzy reads, então evita muitas anomalias comuns, mas ainda permite write skew. No exemplo bancário deles, duas transações leem cada uma dois saldos, cada uma saca de uma conta diferente, e juntas quebram a restrição de que a soma continue não negativa, sem que nenhuma veja a escrita da outra.
- Por isso o isolamento por snapshot não é serializável, e não é estritamente mais forte nem mais fraco que o REPEATABLE READ do ANSI.
- O nome "Repeatable Read" é infeliz na visão dos autores: não dá leituras repetíveis como definido pelo ANSI, e alguns produtos usavam o termo para serializável.

## Análise crítica

O artigo mudou a forma como profissionais e implementadores falam de isolamento, e seus exemplos ainda são usados em ensino. Pontos a ponderar:

- **Ele argumenta sobre definições, não sobre prevalência.** O artigo não mede com que frequência write skew ou outras anomalias acontecem em aplicações reais, então diz que as anomalias são possíveis, não que são comuns.
- **Os autores têm uma posição.** Alguns trabalham para fornecedores de bancos de dados (Microsoft e Sybase), e o artigo recomenda uma forma específica de ler o padrão e de nomear os níveis. É um argumento a favor dessa leitura, ainda que convincente.
- **Alcance do argumento.** Ele trata históricos de instruções simples sobre itens de dados, e os phantoms sobre predicados são cobertos de modo mais leve. Bancos distribuídos e replicados, que hoje importam muito, não são discutidos.
- **O mapa não é final.** Os autores dizem que a hierarquia dos novos níveis é caracterizada pelas anomalias que conhecem, e trabalhos posteriores acrescentaram mais anomalias e níveis.

## Pesquisas futuras

- Estudos sobre quais anomalias realmente aparecem em aplicações em produção e quanto custam.
- Formas eficientes de tornar o isolamento por snapshot serializável, ou de detectar os padrões perigosos em tempo de execução.
- Especificações formais de isolamento que cubram sistemas multiversão, distribuídos e replicados.
- Ferramentas que digam a quem desenvolve a aplicação quais anomalias suas transações podem sofrer no nível de isolamento em uso.
