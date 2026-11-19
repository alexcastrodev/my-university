---
title: "Um tipo de dado JSON replicado livre de conflitos"
summary: Kleppmann e Beresford definem um CRDT com o modelo de dados JSON completo (mapas e listas aninhados em qualquer profundidade, com registradores nas folhas), dão a ele uma semântica operacional formal em que edições concorrentes se combinam sem perder nenhuma atualização e provam, em um apêndice, que réplicas que processaram as mesmas operações ficam no mesmo estado.
researchArea: Sistemas distribuídos
keywords: CRDT, JSON, edição colaborativa, replicação otimista, registrador multivalorado, timestamps de Lamport, consistência eventual forte
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Muitas aplicações modelam seus dados em um formato de armazenamento de uso geral, como o JSON. Essa estrutura de dados é modificada pela aplicação em resposta à entrada do usuário. Essas modificações são bem compreendidas quando feitas de forma sequencial sobre uma única cópia dos dados, mas, se os dados são replicados e modificados de forma concorrente em vários dispositivos, não está claro qual deve ser a semântica. Neste artigo apresentamos um algoritmo e uma semântica formal para uma estrutura de dados JSON que resolve automaticamente as modificações concorrentes, de modo que nenhuma atualização se perde e todas as réplicas convergem para o mesmo estado (um tipo de dado replicado livre de conflitos, ou CRDT). Ela suporta listas e mapas aninhados em qualquer profundidade, que podem ser modificados por inserção, remoção e atribuição. O algoritmo faz toda a combinação no lado do cliente e não depende de garantias de ordenação da rede, o que o torna adequado para dispositivos móveis com conectividade ruim, redes peer-to-peer e sistemas de mensagens com criptografia de ponta a ponta.

## Visão geral

Calendários, listas de tarefas, aplicativos de anotações e documentos compartilhados guardam uma cópia completa do estado em vários dispositivos, e cada um pode ser editado offline. A serializabilidade tornaria esse tipo de aplicação inutilizável com rede ruim, então os autores assumem que cada dispositivo edita a própria cópia e as cópias são reconciliadas depois. As saídas usuais perdem algo: o "last writer wins" (usado no Apache Cassandra, segundo o artigo) descarta em silêncio uma de duas escritas concorrentes, e pedir ao usuário que resolva todo conflito é cansativo. O Dynamo e o CouchDB guardam todos os valores concorrentes de uma chave e deixam a resolução para a aplicação, o que, nas palavras do artigo, equivale a suportar apenas um registrador multivalorado, e funções de merge ingênuas mostram anomalias como itens removidos que reaparecem (veja o [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store)).

A transformação operacional (OT), técnica por trás dos editores colaborativos, em geral trata o documento como uma lista plana, e os sistemas em produção citados no artigo (Google Docs, Etherpad, Apache Wave) dependem de um único servidor para ordenar as operações. O broadcast atômico dispensaria o servidor, mas equivale a consenso e exige um quórum, que um conjunto de celulares muitas vezes não tem. O artigo fica abaixo disso: a única hipótese de rede é que toda mensagem chega, cedo ou tarde, a todas as réplicas, podendo atrasar, vir fora de ordem ou duplicada. Esse é o cenário de [Conflict-free Replicated Data Types](/papers/conflict-free-replicated-data-types), de onde o artigo tira a consistência eventual forte. Já existiam CRDTs isolados para registradores, mapas, contadores e listas; aninhá-los era a peça que faltava.

Vale conhecer antes: timestamps de Lamport (veja [Time, Clocks, and the Ordering of Events](/papers/lamport-time-clocks-ordering-of-events)), a relação acontece-antes e a ideia de CRDT baseado em operações, cujas operações concorrentes comutam.

## Contribuição

- **Um tipo de dado para a árvore JSON inteira.** O documento é uma árvore de mapas (chaves de texto, sem ordem) e listas (ordem definida pela aplicação), com folhas que são registradores guardando valores primitivos. Mapas e listas se aninham livremente. O artigo diz não conhecer trabalho anterior que componha registradores, mapas e listas ordenadas em um único CRDT assim.
- **Um registrador multivalorado como único mecanismo de conflito.** Duas atribuições concorrentes à mesma folha mantêm os dois valores, e a aplicação (ou o usuário) pode resolver depois.
- **Um cursor e uma pequena linguagem de comandos.** `doc`, `.get(key)`, `.idx(i)`, `:=`, `insertAfter`, `delete`, `let`, `yield`. O cursor é um caminho de chaves tipadas mais uma chave final, e nomeia um elemento da lista pelo identificador da operação que o inseriu, não pelo índice.
- **Semântica operacional formal.** Regras para avaliar expressões, gerar operações, aplicá-las e limpar o estado anterior, com a estrutura de operação `op(id, deps, cur, mut)`.
- **Um teorema de convergência** com prova no apêndice.

## Metodologia

É um artigo formal, não experimental. Cada réplica tem um estado local e só os próprios comandos o alteram, produzindo operações que são aplicadas localmente na hora e enfileiradas para difusão. O comando `yield` envia, recebe ou aplica operações de forma não determinística, o que modela uma rede assíncrona sem garantia de ordem. Uma operação remota só é aplicada se for nova e se todas as suas dependências causais (`deps`) já tiverem sido aplicadas.

Toda operação recebe um timestamp de Lamport `(c, p)`: um contador mais o id da réplica, ordenados primeiro pelo contador e depois pelo id. A ordem das listas segue o algoritmo RGA: cada elemento tem um ponteiro `next`, e a regra `INSERT2` pula elementos de timestamp maior, de modo que inserções concorrentes na mesma posição ficam numa ordem determinada pelos timestamps. Elementos removidos continuam como tombstones com o conjunto de presença `pres(k)` vazio, e as chaves dos mapas levam uma marca de tipo (`mapT`, `listT`, `regT`), para que valores de tipos diferentes sob a mesma chave convivam. Remover ou sobrescrever "limpa" apenas o que a operação conhece causalmente, deixando intactas as edições concorrentes.

## Resultados

Seis exemplos (Figuras 1 a 6) mostram o comportamento pretendido, e o apêndice prova a afirmação formal.

- **Atribuição concorrente.** As réplicas p e q atribuem "B" e "C" à mesma chave: as duas terminam com o registrador `{"B", "C"}`.
- **Edição contra remoção de subárvore.** p adiciona "red" a um mapa de cores enquanto q esvazia o mapa e adiciona "green": o resultado mantém "red" e "green" e perde o "blue" antigo. Edições em nível mais baixo não são sobrescritas por uma remoção concorrente acima delas.
- **Criação e inserção concorrentes em listas.** Duas listas criadas sob a mesma chave são combinadas, e os itens adjacentes de cada réplica continuam adjacentes ("eggs, ham" e "milk, flour"). Qual bloco vem primeiro é arbitrário, mas igual em todas as réplicas. Uma lista de caracteres dá um documento de texto (Figura 4).
- **Tipos diferentes sob uma chave.** Um mapa e uma lista atribuídos de forma concorrente à chave "a" são mantidos os dois.
- **Ressurreição.** Se uma réplica remove um item de tarefas enquanto outra altera o campo "done", o item combinado existe com `done: true` e sem título. Os autores tratam isso como uma limitação do princípio de não perder entrada.
- **Teorema.** Se duas réplicas de uma execução válida processaram o mesmo conjunto de operações, elas têm o mesmo estado do documento. A prova é por indução sobre o tamanho do histórico e mostra que uma nova operação comuta com toda operação concorrente (inserções, remoções, atribuições). A vivacidade (toda réplica acaba vendo toda operação) é afirmada, mas não formalizada.

## Análise crítica

O que o artigo não afirma pesa tanto quanto o que ele prova.

- **Não há implementação nem medição neste texto.** A conclusão diz que os autores estão "trabalhando em uma implementação prática" e que relatarão o desempenho em trabalho posterior. A versão lida não descreve biblioteca em JavaScript, benchmark nem aplicação. Desempenho em escala, latência e memória ficam sem exame.
- **O estado cresce sem limite.** Tombstones nunca são removidos, os conjuntos de presença e as entradas dos registradores se acumulam, e `deps` é definido como o conjunto completo de ids de operações, que o próprio artigo chama de impraticável em um sistema real (sugere vetores de versão ou dotted version vectors). A coleta de lixo aparece como trabalho futuro necessário.
- **Sem mover e sem desfazer.** A conclusão chama de úteis a operação de mover (reordenar itens de uma lista ou mover uma subárvore) e o desfazer, e deixa os dois para o futuro, então nenhum tem semântica de merge definida aqui.
- **Edição de texto é só um uso das listas.** A Figura 4 mostra um elemento de lista por caractere, mas o artigo não compara com editores colaborativos em memória, velocidade nem qualidade do texto combinado.
- **A correção depende do modelo.** A prova cobre a segurança (safety) nas regras do artigo, e nenhuma prova verificada por máquina é mencionada. Restrições de unicidade e outros invariantes globais não podem ser expressos em um CRDT, como o artigo reconhece ao contrastar com o Bayou. A linha do [CALM](/papers/keeping-calm-when-distributed-consistency-is-easy) (ligação editorial, não citada por este artigo) explica por que esses invariantes pedem coordenação.
- **Preservar toda entrada pode surpreender** quem programa, como no exemplo da lista de tarefas. Uma linguagem de esquema é sugerida, mas não projetada.

Literatura posterior, fora do artigo e não lida por inteiro aqui: o projeto Automerge se descreve, no README, como uma biblioteca com implementações de CRDTs e um protocolo de sincronização para aplicações local-first, com um pacote em JavaScript; e o Crossref lista "A Highly-Available Move Operation for Replicated Trees" (Kleppmann, Mulligan, Gomes e Beresford, IEEE TPDS, 2022), cujo título trata da lacuna de mover, mas só os metadados foram conferidos.

## Pesquisas futuras

- Coleta de lixo de tombstones e metadados causais compactos, que o artigo deixa em aberto.
- Operações de mover e desfazer para listas e árvores.
- Linguagens de esquema e anotações semânticas (um número que é contador, não registrador) para evitar merges surpreendentes.
- Implementações medidas: memória, custo de merge e tráfego de rede, e comparação com OT e CRDTs de lista na edição de texto.
- Estudar o que os programadores esperam de estados combinados sob concorrência.
