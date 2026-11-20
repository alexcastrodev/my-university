---
title: "Usando a Crash Hoare Logic para certificar o sistema de arquivos FSCQ"
summary: Chen e colegas estendem a lógica de Hoare com condições de crash, procedimentos de recuperação e espaços de endereço lógicos, e a usam para construir o FSCQ, um sistema de arquivos com log de escrita antecipada escrito e provado em Coq, que roda via FUSE a cerca da metade da velocidade do ext4 com data journaling.
researchArea: Sistemas operacionais
keywords: segurança contra crashes, Crash Hoare logic, verificação formal, Coq, sistema de arquivos, log de escrita antecipada, lógica de separação
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

O FSCQ é o primeiro sistema de arquivos com uma prova verificável por máquina (usando o assistente de provas Coq) de que sua implementação cumpre a especificação e cuja especificação inclui crashes. O FSCQ comprovadamente evita bugs que atormentaram sistemas de arquivos anteriores, como fazer escritas em disco sem barreiras suficientes ou esquecer de zerar blocos de diretório. Se um crash acontece em um momento inoportuno, esses bugs podem levar à perda de dados. Os teoremas do FSCQ provam que, sob qualquer sequência de crashes seguidos de reinicializações, o FSCQ recupera o sistema de arquivos corretamente, sem perder dados. Para enunciar os teoremas do FSCQ, este artigo introduz a Crash Hoare logic (CHL), que estende a lógica de Hoare tradicional com uma condição de crash, um procedimento de recuperação e espaços de endereço lógicos para especificar estados de disco em diferentes níveis de abstração. A CHL também reduz o esforço de prova dos desenvolvedores por meio de automação de provas. Usando a CHL, desenvolvemos, especificamos e provamos a correção do sistema de arquivos FSCQ. Embora o projeto do FSCQ seja relativamente simples, experimentos com o FSCQ rodando como sistema de arquivos em nível de usuário mostram que ele basta para executar aplicações Unix com desempenho utilizável. As especificações e provas do FSCQ exigiram bem mais trabalho que a implementação, mas esse trabalho foi administrável até para uma pequena equipe de poucos pesquisadores.

## Visão geral

Um sistema de arquivos pode passar em todos os testes e mesmo assim perder dados se a energia cair entre duas escritas em disco específicas. O artigo (SOSP '15, MIT CSAIL) divide as defesas existentes em testes, análise de programas e model checking, e diz que nenhuma delas garante a ausência de bugs de segurança contra crashes. Assistentes de prova já certificavam compiladores, microkernels como o [seL4](/papers/sel4-formal-verification-of-an-os-kernel) e servidores, mas não código que precisa sobreviver a crashes. Os autores observam que o seL4 não tem estado persistente, então sua especificação não diz nada sobre crashes, e que o [Verdi](/papers/verdi-framework-for-implementing-and-formally-verifying-distributed-systems) assume que seu modelo de falha de nós está correto e deixa a persistência para algum sistema de arquivos. O FSCQ mira essa lacuna complementar.

Contexto no catálogo: o [All File Systems Are Not Created Equal](/papers/all-file-systems-are-not-created-equal-crash-consistent-applications) é citado porque desenvolvedores de aplicações entendem mal o comportamento de crash, e o [Log-Structured File System](/papers/log-structured-file-system) fornece um dos benchmarks. O [IronFleet](/papers/ironfleet-proving-practical-distributed-systems-correct) saiu na mesma conferência; este artigo cita, em vez dele, o trabalho anterior do Ironclad.

Vale conhecer antes: triplas de Hoare {P} código {Q}, lógica de separação (o operador estrela divide um armazenamento em partes disjuntas) e log de escrita antecipada (write-ahead logging).

## Contribuição

- **Crash Hoare logic (CHL).** Uma especificação tem pré-condição, pós-condição e condição de crash, que descreve o disco logo antes do crash, e por isso se parece com a pré e a pós-condição. Uma semântica de execução com recuperação (escrita com o operador ≫ entre um procedimento e seu procedimento de recuperação) diz que, depois de um crash, roda um procedimento de recuperação, talvez muitas vezes. Se esse procedimento é idempotente (sua condição de crash implica sua pré-condição), a CHL deriva a especificação com recuperação a partir da especificação sem ela.
- **Espaços de endereço lógicos.** A lógica de separação é aplicada ao disco, ao disco lógico que um log expõe, à camada de inodes, aos bytes de cada arquivo e a cada diretório. As camadas superiores raciocinam então sobre um disco síncrono simples e ignoram o assíncrono embaixo.
- **Modelo de disco assíncrono.** Cada bloco guarda o último valor escrito mais um conjunto de valores anteriores, qualquer um dos quais pode aparecer depois de um crash. As escritas são atômicas por bloco (um setor de 4 KB). O `disk_sync` de um endereço descarta os valores anteriores, e syncs por endereço consecutivos são reunidos em um único sync global na execução.
- **FscqLog e FSCQ.** Um log de escrita antecipada com transações tudo ou nada, com sete estados de crash provados, sob um sistema de arquivos cujas camadas são cache, alocador de bitmap, inode, arquivo de blocos, diretório, arquivo de bytes e árvore de diretórios.
- **Automação de provas.** A CHL encadeia pré e pós-condições ao longo do fluxo de controle e deixa ao desenvolvedor, em geral, só as invariantes de representação.

## Metodologia

O FSCQ segue o projeto do sistema de arquivos do xv6, sem suporte a multiprocessador e com um bitmap separado para inodes. Implementa as chamadas centrais do POSIX (blocos indiretos, diretórios aninhados, rename) com atomicidade tudo ou nada e durabilidade imediata: os efeitos de uma chamada estão em disco quando ela retorna. Não há hard links nem `fsync`. Os arquivos abertos são nomeados pelo número do inode, e o FUSE mantém o mapeamento dos descritores.

A extração do Coq produz Haskell, mais um driver de 400 linhas em Haskell e outras 350 linhas para palavras de tamanho fixo, operações de bloco e uma política de substituição de cache. A política de substituição é validada em tempo de execução, como no CompCert, em vez de provada. Os benchmarks usam um i7-3667U de quatro núcleos com 8 GB, Linux 3.19, um SSD Intel e GHC 7.10.2, comparando o FSCQ com o sistema de arquivos do xv6 (modificado para escritas assíncronas e portado para FUSE) e com o ext4, todos em modo síncrono (no ext4, `data=journal` e `sync`). As cargas são git clone, `make` do xv6 e do benchmark LFS, os testes de arquivo grande e pequeno do LFS, limpeza e o mailbench.

## Resultados

- **Tamanho e esforço.** A Figura 18 soma 31.397 linhas de código e prova juntas, contra cerca de 3.000 linhas de C do sistema de arquivos do xv6. O artigo não separa prova de código. Vários pesquisadores levaram cerca de um ano e meio, a maior parte em provas e especificações, e conferir as provas leva 11 horas. O `Print Assumptions` não mostra axiomas sem prova.
- **Desempenho.** O FSCQ fica perto do xv6; sua implementação em Haskell usa cerca de 4 vezes mais CPU que a do xv6. O FSCQ é cerca de 2 vezes mais lento que o ext4 com data journaling síncrono: compilar o código do xv6 leva 3,7 s nos sistemas de arquivos FSCQ e xv6 e 2,2 s no ext4. O FUSE acrescenta pouco. No mailbench, com 10 transações por mensagem e cerca de 2,8 ms por sync, uma mensagem leva 64 ms no ext4, 103 ms no xv6 e 118 ms no FSCQ. O FSCQ precisa de quatro syncs de disco por commit e o ext4 de dois. As barras por fase estão na Figura 19 (um gráfico, não lido aqui).
- **Teste de crash.** O `fsstress` não achou problemas. Gravando as escritas e os syncs de uma carga fixa, os autores montaram 320 estados de crash, recuperaram cada um e encontraram 10 estados lógicos distintos, todos consistentes após inspeção manual.
- **Classes de bugs.** Das oito classes discutidas, violações de invariantes, casos de canto, erros de logging, mau uso da API do log e erros de baixo nível são eliminados pelos teoremas. Bugs de alocação de recursos são cobertos em parte (blocos nunca se perdem, mas a especificação não exige estar sem espaço antes de devolver ENOSPC). Códigos de erro errados continuam em aberto onde não foram especificados, e corridas ficam fora do escopo.
- **Evolução.** Escritas assíncronas custaram cerca de 1.000 linhas na CHL e mais da metade do FscqLog, sem mudar nada acima dele. Blocos indiretos custaram cerca de 1.500 linhas na camada de inodes. O cache de buffers custou cerca de 300 linhas no FscqLog e 600 acima. Uma mudança no layout do log custou cerca de 50 linhas de código e 100 de prova.

## Análise crítica

O próprio artigo declara vários limites.

- **Base confiável.** A extração coloca o compilador e o runtime do Haskell, o driver e a biblioteca FUSE de Haskell na base confiável. O modelo de disco assume escritas atômicas de setor e crashes do tipo fail-stop.
- **Escopo.** Uma transação por vez, sem multiprocessadores, sem durabilidade adiada, sem atributos estendidos nem arquivos muito grandes. O `log_commit` pode devolver erro se uma transação escrever demais.
- **Lacunas na especificação.** Os códigos de erro em sua maioria não são especificados, e o artigo admite que a especificação ou o código não verificado ainda poderiam estar errados, o que o experimento de crash abaixo só sugere que não estão.

Os pontos a seguir são uma leitura da evidência, não afirmações do artigo.

- **Sem contagem de bugs.** O artigo não relata bugs achados pelas provas durante o desenvolvimento. O argumento sobre bugs é por categorias de estudos anteriores, não por uma contagem medida.
- **O custo está nos benchmarks.** O artigo atribui a diferença aos syncs (quatro por commit contra dois). A base do ext4 é `data=journal` com `sync`, que não é o padrão, e outros modos do ext4 chegam a cerca do dobro dessa vazão em alguns casos, então o fator 2 depende da base escolhida.
- **Vizinhos no catálogo.** O [Hyperkernel](/papers/hyperkernel-push-button-verification-of-an-os-kernel) deixa seu sistema de arquivos sem verificação no espaço do usuário, e a prova do [seL4](/papers/sel4-formal-verification-of-an-os-kernel) assume o hardware. O [CertiKOS](/papers/certikos-extensible-architecture-for-certified-concurrent-os-kernels) do catálogo é o artigo posterior do OSDI, enquanto o FSCQ cita um anterior, do POPL.
- **Mesmo grupo, outro objetivo.** O [Biscuit](/papers/the-benefits-and-costs-of-writing-a-posix-kernel-in-a-high-level-language), do mesmo grupo do MIT, também traz um sistema de arquivos com log, mas esse artigo avalia o custo e a programabilidade do Go, não provas.
- **Literatura posterior, não lida.** Só por metadados do Crossref e pela página da USENIX: o mesmo grupo publicou o DFSCQ (SOSP 2017, "Verifying a high-performance crash-safe file system using a tree specification"), e Sigurbjarnarson, Bornholt, Torlak e Wang publicaram "Push-Button Verification of File Systems via Crash Refinement" (OSDI 2016). Não li nenhum dos dois.

## Pesquisas futuras

- Agrupar transações e registrar no log só metadados, o que os autores esperam aproximar o FSCQ do logging do ext4.
- Durabilidade adiada por meio de `fsync` e uma especificação sem a suposição de setor atômico.
- Suporte a multiprocessadores, que o artigo chama de a única mudança que pode exigir retrabalho global.
- Gerar C ou assembly em vez de Haskell, o que o artigo sugere para a diferença de CPU em relação ao xv6.
- Verificar o caminho completo do Coq até o binário em execução, incluindo o extrator e o runtime do Haskell (o artigo só observa que outros projetos chegaram até o assembly).
- Colocar um sistema de arquivos verificado sob os servidores em espaço do usuário de um kernel verificado, uma combinação que cabe no Hyperkernel, cujo sistema de arquivos roda sem verificação no espaço do usuário (sugestão minha, não do artigo).
