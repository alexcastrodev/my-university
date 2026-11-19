---
title: "Nem todos os sistemas de arquivos são iguais: a complexidade de escrever aplicações consistentes após falhas"
summary: Pillai e colegas mostram que bancos de dados, armazenamentos chave-valor, sistemas de controle de versão e sistemas distribuídos dependem de propriedades de persistência do sistema de arquivos que o POSIX não promete. As ferramentas BoB e ALICE testam dezesseis configurações de sistemas de arquivos e onze aplicações, e encontram 60 vulnerabilidades a falhas.
researchArea: Sistemas operacionais
keywords: consistência após falhas, propriedades de persistência, sistemas de arquivos, fsync, atomicidade, ordenação, vulnerabilidades a falhas, write-ahead logging, ALICE, BoB
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Apresentamos o primeiro estudo abrangente de protocolos de consistência após falhas no nível da aplicação, construídos sobre sistemas de arquivos modernos. Descobrimos que as aplicações usam protocolos de atualização complexos para persistir o estado e que a correção desses protocolos depende muito de comportamentos sutis do sistema de arquivos subjacente, que chamamos de propriedades de persistência. Desenvolvemos uma ferramenta chamada BoB, que testa empiricamente as propriedades de persistência, e a usamos para demonstrar que essas propriedades variam muito entre seis sistemas de arquivos populares do Linux. Construímos um framework chamado ALICE, que analisa protocolos de atualização de aplicações e encontra vulnerabilidades a falhas, isto é, código do protocolo de atualização que exige certas propriedades de persistência para estar correto. Com o ALICE, analisamos onze sistemas muito usados (incluindo bancos de dados, armazenamentos chave-valor, sistemas de controle de versão, sistemas distribuídos e software de virtualização) e encontramos 60 vulnerabilidades no total, muitas com consequências graves. Também mostramos que o ALICE pode avaliar o efeito de novos projetos de sistemas de arquivos sobre a consistência no nível da aplicação.

## Visão geral

O artigo foi publicado no OSDI '14 (Broomfield, outubro de 2014) e vem do grupo Arpaci-Dusseau, da Universidade de Wisconsin-Madison. O ponto de partida é uma lacuna entre duas camadas. O POSIX, a interface descendente de [The UNIX Time-Sharing System](/papers/unix-time-sharing-system), especifica o que uma chamada de sistema faz na memória, mas não quais estados de disco são possíveis depois de uma queda. Cada sistema de arquivos, e cada modo do mesmo sistema, responde de um jeito, então os desenvolvedores chutam. Enquanto isso, aplicações como SQLite e LevelDB rodam sobre sistemas de arquivos em vez de discos crus e ainda precisam sobreviver a falhas, usando protocolos de atualização complexos para ficar consistentes e rápidas ao mesmo tempo.

As técnicas que mantêm a consistência dos metadados (logging, copy-on-write, soft updates) são tratadas como bem testadas. Uma delas é a ideia do [Log-Structured File System](/papers/log-structured-file-system). O artigo pergunta o que essas garantias entregam às aplicações acima, e não se os sistemas de arquivos em si estão corretos.

Os pareamentos com o catálogo neste parágrafo são meus, não do artigo. O HDFS descende do projeto do [The Google File System](/papers/google-file-system), e o [ZooKeeper](/papers/zookeeper-wait-free-coordination-internet-scale-systems) é uma das onze aplicações analisadas. Sistemas de arquivos que mudam o que uma queda pode deixar para trás, como o journaling dividido do [Oxbow](/papers/oxbow-coordinated-architecture-for-multi-component-file-systems) ou o projeto em espaço de usuário do [Trio](/papers/trio-high-performance-and-secure-userspace-nvm-file-systems), são sistemas cujo comportamento em falhas um APM poderia descrever, embora nenhum dos dois artigos use o ALICE.

Vale saber antes: o que o fsync faz e não faz, por que se usa rename para atualizar um arquivo "atomicamente" e o que é alocação atrasada (delayed allocation).

## Contribuição

- **Propriedades de persistência.** O artigo nomeia os comportamentos do sistema de arquivos que importam após uma queda e os divide em dois grupos: atomicidade (uma escrita, um append ou um rename acontece por inteiro ou não acontece, em tamanho e em conteúdo) e ordenação (uma chamada pode ser persistida depois de uma chamada posterior).
- **BoB (Block Order Breaker).** Ferramenta que grava o I/O de blocos de uma carga pequena sob um sistema de arquivos, o reordena em estados de disco legais, roda a recuperação do sistema de arquivos e verifica se uma propriedade vale.
- **ALICE (Application-Level Intelligent Crash Explorer).** Framework com cerca de 4000 linhas de Python que deriva estados pós-falha do trace de chamadas de sistema de uma aplicação, sob um modelo abstrato de persistência (APM), e relata as vulnerabilidades ligadas a linhas de código-fonte e à propriedade de persistência que cada uma exige. Também desenha diagramas dos protocolos de atualização.
- **Um estudo de onze aplicações.** LevelDB, GDBM, LMDB, SQLite, PostgreSQL, HSQLDB, Git, Mercurial, HDFS, ZooKeeper e VMware Player, com 60 vulnerabilidades encontradas.
- **ext3-fast.** Variante hipotética do ext3, modelada no ALICE e não implementada, em que o fsync persiste só o arquivo sincronizado e os demais dados continuam ordenados entre si.

## Metodologia

**BoB.** Uma carga fornecida pelo usuário estressa uma propriedade (por exemplo, sobrescritas de um certo tamanho). O BoB coleta o trace de blocos, reordena blocos respeitando as barreiras de disco, grava blocos selecionados em disco, roda a recuperação e verifica a propriedade. Achar uma única imagem que falha prova que a propriedade não vale, mas o inverso não pode ser provado: só se testam reordenações simples e todos os prefixos do trace. Foram estudados seis sistemas de arquivos do Linux (ext2, ext3, ext4, btrfs, xfs, reiserfs) em 16 configurações.

**ALICE.** O usuário fornece um snapshot inicial, um script de carga e um script verificador (checker) que confere os invariantes da carga. O ALICE executa a carga, converte o trace de chamadas de sistema (write, pwrite, writev, escritas em mmap etc.) em operações lógicas (overwrite, append, truncate, link, unlink, rename, stdout) e as divide em microoperações: write block, change file size, create dir entry, delete dir entry, stdout. O APM define quais microoperações são atômicas e quais podem chegar ao disco antes de outras. O APM padrão é fraco: só ordena operações antes de um sync no mesmo arquivo. O ALICE então constrói estados pós-falha de três formas: prefixos da sequência de chamadas (atomicidade entre chamadas), estados parciais de uma única chamada (uma escrita dividida em blocos ou em três partes, e appends cujos blocos novos contêm dados aleatórios, o que modela o tamanho chegando ao disco primeiro) e, para cada par de chamadas A e B, o estado com tudo aplicado até B exceto A (ordenação). Os estados são indexados por hash para pular duplicatas e verificados em threads paralelas. As vulnerabilidades estáticas são linhas do código-fonte, achadas por stack traces, e as dinâmicas são as chamadas afetadas.

**Aplicações.** As cargas testam 34 opções de configuração. Os verificadores são dos autores e podem ser grandes (cerca de 500 linhas para o Git). Onde a documentação não promete nada, a expectativa de um usuário leigo conta como invariante.

## Resultados

- **Os sistemas de arquivos diferem muito.** A Tabela 1 do artigo mostra que sobrescritas de um setor são atômicas em todas as configurações testadas, operações de diretório como rename parecem atômicas em sistemas com journaling e copy-on-write, e appends de vários blocos não são atômicos em lugar nenhum (um prefixo dos dados parece atômico). Ext3, ext4 e reiserfs em modo data journaling, e ext2 em modo sync, persistem todas as operações testadas em ordem. Ext2 e btrfs reordenam operações de diretório livremente. Com alocação atrasada, um append pode ser persistido depois de operações posteriores, exceto no idioma append seguido de rename.
- **60 vulnerabilidades estáticas (156 dinâmicas).** As aplicações falharam em mais de 4000 estados pós-falha. Por aplicação: LevelDB 1.10 tem 10, HSQLDB 10, Mercurial 10, Git 9, LevelDB 1.15 6, GDBM 5, ZooKeeper 4, HDFS 2, LMDB 1, SQLite (rollback) 1, PostgreSQL 1, VMware 1 e SQLite em modo WAL 0.
- **Tipos.** 27 vulnerabilidades de ordenação e 12 de durabilidade (sete aplicações perdem durabilidade). A Tabela 3(a) lista colunas de atomicidade com 6 (entre chamadas), 4 (appends e truncates), 3 (sobrescritas de um bloco) e 9 (renames e unlinks); as colunas somam 61 porque as mesmas linhas podem exibir comportamentos diferentes. No texto: 7 das 11 aplicações falham sem ordenação, 10 das 11 esperam alguma atomicidade e 7 das 11 não recebem a durabilidade que um usuário esperaria, muitas vezes porque um diretório não passa por fsync.
- **Consequências.** 5 erros silenciosos, 12 perdas de dados, 25 casos de "não abre" e 17 leituras ou escritas com falha. Sete aplicações sofrem perda de dados, e as duas versões do LevelDB e o HSQLDB sofrem erros silenciosos.
- **Padrões específicos.** Três aplicações (HSQLDB, LevelDB 1.15, Mercurial) exigem que appends sejam atômicos em conteúdo. LMDB, PostgreSQL e ZooKeeper exigem que sobrescritas abaixo de 200 bytes sejam atômicas. Nenhuma vulnerabilidade de sobrescrita de vários blocos foi encontrada. A heurística de rename seguro corrige só três vulnerabilidades, e três aplicações precisam que o fsync de um arquivo persista também a entrada de diretório dele.
- **Sistemas de arquivos atuais.** Das 60, o número exposto é 16 no ext3 writeback, 12 no ext3 ordered, 10 no ext3 data journaling, 17 no ext4 ordered e 31 no btrfs. Algumas aplicações não mostram nenhuma em qualquer sistema modelado.
- **Desenvolvedores.** Os autores contataram os desenvolvedores de oito aplicações. O LevelDB 1.10 foi corrigido, o LevelDB 1.15 foi corrigido em paralelo, e o HDFS e duas questões do ZooKeeper estavam em análise. O SQLite não dá durabilidade com journal de rollback, embora a documentação sugira que sim.
- **ext3-fast.** As vulnerabilidades de ordenação das aplicações estudadas não aparecem nele. Escrever 250 MB em um arquivo e depois dar fsync em outro levou cerca de quatro segundos no ext3 ordered e 40 ms em partições separadas imitando o ext3-fast, 100 vezes mais rápido.

## Análise crítica

Os limites são declarados pelos próprios autores. O ALICE não é completo e pode deixar vulnerabilidades passarem. Ele exige que uma pessoa escreva cargas e verificadores, e serializa as threads na ordem em que as chamadas foram emitidas. Não trata atributos de arquivo. O estudo conta linhas de código que dependem do comportamento do sistema de arquivos, então, explicitamente, não serve para comparar a correção de aplicações. Várias vulnerabilidades vêm da leitura dos autores sobre expectativas de usuários, e não de garantias documentadas (marcadas com asterisco na Tabela 3). O ALICE esconde outras vulnerabilidades de uma chamada de sistema depois de achar uma para ela. O BoB só consegue refutar propriedades.

O que o artigo não faz: os modelos cobrem atomicidade, ordenação e o append com conteúdo lixo. O texto não modela erros de mídia, bit rot nem um cache de disco que ignora o fsync, suspeita que os desenvolvedores levantaram. Os testes são de cargas em uma única máquina, inclusive para HDFS e ZooKeeper. O artigo não prova a correção de nenhuma aplicação.

Literatura posterior, com fontes que vi só como resumo: Mohan e colegas (OSDI '18) propõem o teste de caixa-preta limitado (bounded black-box crash testing) com as ferramentas CrashMonkey e Ace. Elas testam os próprios sistemas de arquivos com cargas de chamadas ligadas ao fsync e relatam 10 bugs novos em sistemas de arquivos maduros do Linux. É um alvo diferente do deste artigo, que testa aplicações contra um modelo.

## Pesquisas futuras

- Padronizar as propriedades de persistência, para que aplicações e sistemas de arquivos possam declará-las.
- Automatizar cargas e verificadores, por exemplo com técnicas de model checking, que os autores consideram ortogonais ao ALICE.
- Avaliar novos projetos de sistemas de arquivos e de armazenamento (como NVM com atomicidade por byte) já na fase de projeto, com um APM.
- Dar às aplicações interfaces melhores que o fsync em arquivos e diretórios, lembrando que o fsync de diretório não é fácil de alcançar em Java.
