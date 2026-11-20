---
title: "Sobre a dualidade das estruturas de sistemas operacionais"
summary: Lauer e Needham argumentam que os projetos de sistemas operacionais "orientados a mensagens" e "orientados a procedimentos" dos anos 1970 são duais, com mapeamento construção a construção, a mesma lógica de programa e, segundo eles, o mesmo desempenho, de modo que a escolha deve seguir a arquitetura da máquina e não a aplicação.
researchArea: Sistemas operacionais
keywords: dualidade, sistemas orientados a mensagens, sistemas orientados a procedimentos, monitores, Mesa, sincronização de processos, computador CAP, projeto de kernel
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

Muitos projetos de sistemas operacionais podem ser colocados em uma de duas categorias bem grosseiras, conforme implementam e usam as noções de processo e sincronização. Uma categoria, o "sistema orientado a mensagens", caracteriza-se por um número relativamente pequeno e estático de processos, com um sistema explícito de mensagens para a comunicação entre eles. A outra, o "sistema orientado a procedimentos", caracteriza-se por um número grande e de rápida variação de pequenos processos e por um mecanismo de sincronização baseado em dados compartilhados. O artigo demonstra que as duas categorias são duais uma da outra e que um sistema construído segundo um modelo tem uma contrapartida direta no outro. A principal conclusão é que nenhum dos modelos é inerentemente preferível, e que a escolha deve depender da arquitetura da máquina sobre a qual o sistema é construído, não da aplicação que ele vai servir.

## Visão geral

O artigo foi apresentado no Second International Symposium on Operating Systems (IRIA, outubro de 1978) e reimpresso no ACM SIGOPS Operating Systems Review 13(2), abril de 1979, pp. 3-19. Hugh Lauer estava no Xerox PARC e Roger Needham em Cambridge (o trabalho foi feito durante uma licença sabática no PARC, no verão de 1977). O contexto é uma discussão que, segundo os autores, tomava as equipes de projeto: um sistema operacional deve ser feito de poucos processos que trocam mensagens, ou de muitos processos leves que chamam procedimentos e sincronizam sobre dados compartilhados? Eles dizem que os debates sobre o mecanismo de processos da linguagem e do sistema Mesa, no PARC e na System Development Division, foram o que os levou a escrever a análise.

É um artigo de posição, construído sobre dois modelos idealizados e argumento informal. Ele se descreve como "um artigo empírico, no sentido dos estudos empíricos nas ciências naturais", mas também diz que as observações se apoiam em argumentos informais, não em provas formais.

Vale conhecer antes: processos e semáforos ou locks, os monitores de Hoare (um lock mais variáveis de condição associados a um módulo) e o custo de uma troca de contexto.

Artigos do catálogo relacionados, pareamentos meus (o artigo de 1978 não pode citá-los): [Implementing Remote Procedure Calls](/papers/implementing-remote-procedure-calls) constrói uma interface de chamada de procedimento sobre pacotes, no mesmo ambiente Mesa da Xerox; [The Multikernel](/papers/multikernel-new-os-architecture-scalable-multicore-systems) estrutura o SO como núcleos que trocam mensagens explícitas, escolha que os autores ligam ao hardware; [The Protection of Information in Computer Systems](/papers/protection-of-information-in-computer-systems) é o pano de fundo geral de proteção para os sistemas de capacidades que o artigo cita (CAP, Hydra, Plessey System 250).

## Contribuição

- **Dois modelos canônicos.** O modelo orientado a mensagens tem um número pequeno e estático de processos grandes, canais de mensagens explícitos, pouco compartilhamento de memória e um espaço de endereçamento ligado a cada processo. O modelo orientado a procedimentos tem muitos processos muito pequenos, criação e remoção rápidas, comunicação por dados compartilhados protegidos por locks e um contexto ligado à função em execução, não ao processo.
- **Primitivas.** Do lado das mensagens: `SendMessage`, `AwaitReply`, `WaitForMessage`, `SendReply`, canais e portas de mensagens, `CreateProcess` (sem remoção, que seria "confusa e sem importância"). Do lado dos procedimentos, como extensões hipotéticas do Mesa: procedimentos, `FORK` e `JOIN`, monitores e procedimentos `ENTRY`, `NEW` e `START`, variáveis de condição com `WAIT` e `SIGNAL`.
- **Um gerenciador de recurso padrão em cada estilo.** No modelo de mensagens, um processo com um laço que espera mensagem em um conjunto de portas e um `case` sobre a porta. No modelo de procedimentos, um monitor com estado global e um procedimento `ENTRY` por serviço.
- **O mapeamento de dualidade.** Processos e `CreateProcess` correspondem a monitores e `NEW`/`START`; canais de mensagens a identificadores de procedimentos externos; portas a identificadores de procedimentos `ENTRY`; `SendMessage` com `AwaitReply` imediato a uma chamada simples de procedimento; `AwaitReply` adiado a `FORK` e `JOIN`; `SendReply` a `RETURN`; o laço principal com `WaitForMessage` e `case` ao lock do monitor e ao atributo `ENTRY`; os ramos do case às declarações `ENTRY`; a espera seletiva por mensagens às variáveis de condição.
- **Três observações.** Os programas são logicamente idênticos e textualmente muito parecidos, o desempenho (filas, tempos de espera, taxas de serviço) é idêntico sob escalonamento idêntico, e as primitivas de cada modelo podem ser tão eficientes quanto as do outro.

## Metodologia

Não há experimento nem formalismo. Os autores definem os dois modelos em inglês informal, dão os esqueletos de gerenciador de recurso e argumentam por transformação: troca-se cada construção pela correspondente (cada monitor vira um processo com laço principal, chamadas viram `SendMessage` e `AwaitReply`, retornos viram `SendReply`, variáveis de condição viram espera seletiva) e verifica-se que nenhum algoritmo, estrutura de dados ou estratégia de interface muda. O argumento de desempenho divide o tempo de execução em três componentes (a execução dos próprios programas, o custo das primitivas e as filas e esperas) e defende que cada um se preserva. O apoio empírico é um estudo de caso, o computador CAP de Cambridge, mais duas máquinas citadas por terem primitivas rápidas em microcódigo.

## Resultados

Tudo abaixo são afirmações do próprio artigo.

- **O mapeamento é uma transformação direta de programas, não uma simulação.** Os autores enfatizam que não se trata da técnica ingênua de simular um conjunto de primitivas com o outro. Só o código de inicialização muda de lugar (num monitor ele vem depois dos procedimentos, num processo antes do laço principal).
- **Identidade textual.** Se o kernel orientado a mensagens for embutido numa linguagem fortemente tipada, com o corpo do processo absorvido pela unidade da linguagem e os envios de mensagem tipados como chamadas ou `FORK`s, o sistema dual é "textualmente idêntico, exceto pela grafia de certas palavras-chave".
- **Desempenho por argumento.** As primitivas teriam a mesma complexidade (enviar versus chamar ou fazer `FORK` de um procedimento `ENTRY`, sair de um monitor versus esperar novas mensagens, troca de processo, escalonamento, memória virtual). Isso é "afirmado sem prova", nas palavras deles. Evidência citada: o GEC 4080, com enfileiramento de mensagens, troca de processo e despacho em microcódigo, e uma implementação do Mesa com as operações duais em microcódigo, em velocidade semelhante.
- **Onde apareceu na prática: o CAP.** No computador CAP de Cambridge, um processo que gerenciava nomes internos do sistema (um diretório central com contagens de referência) se mostrou caro por causa do sistema de mensagens e foi incorporado a cada processo como procedimento protegido. O texto "mal precisou ser alterado". O restante do sistema operacional do CAP passou a ser escrito num estilo que "mostrou-se notavelmente parecido com os modelos abstratos deste artigo".
- **A escolha é de segunda ordem.** Os dois estilos levam a estruturas de programa e desempenho parecidos (ordem zero) e a complexidade de implementação parecida (primeira ordem), então a base da escolha é o substrato: organização da memória virtual, tamanho do estado salvo na troca de contexto, facilidade de escalonar e despachar, dispositivos e interrupções, conjunto de instruções e registradores. Exemplo: onde o processo está atado à memória virtual e é fácil enfileirar blocos de mensagem, mas difícil fazer chamada protegida, use mensagens; num sistema com pilha à la Algol e alocação estruturada em blocos, procedimentos.
- **Uma afirmação sociológica.** Os autores dizem que as discussões de corredor sobre processos e sincronização tratam de questões que "esta análise sugere serem irrelevantes", e que a palavra "processo" significa coisas muito diferentes nos dois mundos.
- **Classificação de sistemas reais.** Orientados a mensagens: IBM OS/360 e GEC 4080. Orientados a procedimentos: HYDRA e Plessey System 250 (o modelo canônico de procedimentos é escrito como extensões hipotéticas do Mesa). Eles também dizem que tentativas de combinar características fundamentais das duas categorias "fracassaram ou foram abandonadas".

## Análise crítica

- **Nem prova, nem medição.** O artigo diz que seus argumentos são informais, que a igualdade de desempenho é afirmada sem prova e que nenhum sistema é medido. Os autores admitem que a conclusão "desafia a crença" de colegas e que "o tempo dirá".
- **Condições da equivalência.** Ela pressupõe programas escritos estritamente no estilo canônico de gerenciador de recurso, processadores e dispositivos semelhantes, "o devido cuidado" nos kernels e disciplinas idênticas de escalonamento e filas. Os autores dizem que o mapeamento falha ou fica artificial quando as facilidades de processo, ou os gerenciadores de recurso, diferem muito do modelo canônico. Citam o `WAIT` em qualquer ponto de chamadas `ENTRY` aninhadas como mais rico que esperar na chegada de mensagem, e o comparam ao `goto`.
- **Modelos, não sistemas.** Eles comparam seus modelos a superfícies sem atrito: nenhum sistema real corresponde a nenhum deles, e a maioria mistura os dois. Notam também que a maioria dos sistemas é difícil de reestruturar por "razões acidentais" (endereçamento, dados globais), o que explica os poucos exemplos.
- **Escopo.** O texto trata de um kernel e da arquitetura de uma máquina. Não discute comunicação de rede, falha de nós nem perda de mensagens, então o argumento nada diz sobre se chamadas em estilo de procedimento continuam equivalentes entre máquinas.
- **Literatura posterior (fora deste artigo, não verificada a fundo).** Lampson e Redell, "Experience with Processes and Monitors in Mesa" (Communications of the ACM 23(2), 1980, DOI 10.1145/358818.358824), é o acompanhamento do Mesa do lado orientado a procedimentos; só conferi os metadados e não li o texto. No catálogo, as páginas do Multikernel e do RPC mostram troca de mensagens e chamada de procedimento escolhidas por razões ligadas ao hardware ou à distribuição, o que combina com o argumento do "substrato", mas esses artigos não citam este.

## Pesquisas futuras

- Testar a equivalência num kernel real: portar um subsistema entre os dois estilos e medir filas, trocas de contexto e latência, o que o artigo só argumenta.
- Achar as construções sem dual (o artigo pergunta se tal primitiva é "elegante" ou "imaginativa demais") e a fronteira onde o mapeamento quebra.
- Estudar o caso com máquinas e falhas: como a distribuição muda o custo de uma chamada versus uma mensagem, começando por [Implementing Remote Procedure Calls](/papers/implementing-remote-procedure-calls).
- Ler os debates posteriores (threads versus eventos, atores, microkernels versus kernels monolíticos) à luz deste artigo; não verifiquei essas fontes aqui.
- Aproveitar a sugestão do artigo de um modelo uniforme das interações entre componentes para prever o desempenho antes de projetar o sistema.
