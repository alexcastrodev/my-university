---
title: "Uma API simples pode causar centenas de bugs: uma análise dos bugs de refcounting em todos os kernels Linux modernos"
summary: Um estudo manual de 1.033 bugs de refcounting corrigidos no Linux de 2005 a 2022 mostra que a maioria causa vazamento de memória, que muitos vivem por anos e que algumas armadilhas de design de API explicam centenas deles, e depois transforma nove antipadrões em verificadores estáticos que reportam 351 bugs novos.
researchArea: Sistemas operacionais
keywords: contagem de referências, kernel linux, vazamentos de memória, use-after-free, estudo de bugs, verificadores estáticos, antipadrões
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

A contagem de referências (refcounting) permite que um programa libere um objeto quando sua última referência desaparece: um inteiro conta as referências, cada nova referência precisa incrementá-lo, cada referência descartada precisa decrementá-lo, e em zero a memória é liberada. No kernel Linux essas chamadas são manuais, e os autores citam um trabalho anterior segundo o qual 93,5% dos arquivos do kernel envolvem refcounting. Um decremento esquecido vaza memória, porque o contador nunca chega a zero. Um incremento esquecido, ou um decremento que vem cedo demais, libera um objeto que ainda está em uso, um use-after-free (UAF).

Este artigo do SOSP 2023 (o 29º ACM Symposium on Operating Systems Principles, em Koblenz) vem do Institute of Software da Academia Chinesa de Ciências (TCA e SKLCS), da University of Chinese Academy of Sciences, da Tsinghua University, do Zhongguancun Laboratory e do CNITSEC. Ele faz a pergunta que os muitos detectores existentes não fazem: por que os bugs de refcounting continuam sendo reportados em número crescente, e o que eles têm em comum?

Termos principais: uma API com refcounting embutido faz outro trabalho (achar um dispositivo, interpretar um nó), mas incrementa o contador do objeto que devolve, e a API do tipo find é o caso mais comum. UAD (use-after-decrease) é mexer em um objeto depois da chamada que descarta a referência. Um smartloop é uma macro como `for_each_matching_node` cuja iteração esconde as chamadas de get e put. Um antipadrão é um template semântico de um caminho de código com bug, usado para construir um verificador.

Vale conhecer antes: gerenciamento manual de memória em C, o que é um UAF e a tag `Fixes:` nas descrições de patch do kernel. O artigo deixa de fora os bugs de refcounting causados por condições de corrida. O [OZZ](/papers/ozz-kernel-out-of-order-concurrency-bugs) ataca outra classe de bugs do kernel que dependem de concorrência para aparecer, e o [kSTEP](/papers/kstep-deterministic-testing-of-linux-cpu-scheduler-bugs) é um estudo parecido, de correções de bugs, para o scheduler. Nenhum dos dois é citado aqui, e os dois pareamentos são meus.

## Contribuição

- **Um dataset construído a partir do histórico.** Os autores reúnem 1.033 bugs de refcounting de 753 versões do kernel lançadas de 2005 a 2022. Um primeiro filtro procura patches que adicionam, removem ou movem chamadas cujos nomes contêm palavras como get, take, hold, grab, put, drop ou release, e um segundo confere a implementação da API. Isso deu 1.825 candidatos entre mais de um milhão de logs de commit, e a leitura manual da mensagem do commit, do patch, do contexto e da discussão na lista de e-mail manteve 1.033.
- **Uma classificação com templates semânticos.** Os bugs são classificados como missing (um incremento ou decremento omitido) ou misplacing (a chamada está no lugar errado), mais um grupo Others. Os templates usam operadores para incremento, decremento, atribuição, dereferência, lock e unlock, e contextos como instrução, bloco e função, de modo que um vazamento em caminho de erro se lê como início da função, incremento, bloco de erro, fim da função.
- **Causas-raiz em quatro grupos.** Desvio de implementação cobre APIs que incrementam mesmo em caso de erro (return-error) ou que devolvem NULL. Refcounting oculto cobre smartloops e APIs cujos nomes não dizem nada sobre refcounting. Local negligenciado cobre caminhos de erro, funções emparelhadas que rodam em momentos diferentes (open e release, probe e remove) e chamadas diretas a `kfree`. Risco futuro cobre o UAD e as referências que escapam por uma variável global ou um parâmetro de saída.
- **Nove antipadrões e verificadores.** Cada antipadrão vira um verificador estático. Parsers léxicos estendidos a partir do PLY encontram estruturas com contagem de referências, APIs de refcounting e smartloops, e o Joern gera grafos de propriedades de código. Os verificadores não pretendem ser corretos nem completos, só testar se as causas-raiz são reais. Os autores dizem que o LLVM falhou diante das muitas configurações de compilação específicas de cada arquitetura.

## Metodologia

O estudo tem três etapas. Primeiro, o dataset acima, com uma discussão de ameaças à validade: bugs podem passar despercebidos quando um patch move um `mutex_unlock` e não muda nenhuma chamada de refcounting, ou quando a mensagem do commit não tem as palavras-chave, e correções erradas são removidas descartando qualquer bug cujo id de commit seja alvo da tag `Fixes` de outro commit. Segundo, estatísticas sobre impacto, distribuição por subsistema e tempo de vida. Os tempos de vida usam as tags `Fixes`, então cobrem só os 567 bugs que têm uma.

Terceiro, a inferência de causas-raiz apenas em bugs representativos: todos os bugs de decremento ausente (67,2%), os bugs de UAD (9,1%) e os bugs de incremento ausente intra-unpaired (5,1%). Para testar a teoria dos nomes, os autores treinam word2vec (CBOW) em mais de um milhão de logs de commit e calculam a similaridade de cosseno entre palavras-chave de nomes de API (find, parse, open, foreach) e palavras de refcounting (get, put, hold, release) para os 254 bugs intra-unpaired. Depois os verificadores rodam sobre o código de releases recentes do kernel, um patch é enviado para cada relato e as respostas dos desenvolvedores são contadas.

## Resultados

Estes são os resultados relatados pelos autores.

- **Impacto.** 741 dos 1.033 bugs (71,7%) podem vazar memória e 292 (28,3%) podem causar um UAF. Os bugs de decremento ausente são 694 (67,2%), e 590 (57,1%) podem ser achados procurando chamadas sem par dentro de uma única função.
- **Distribuição.** Os bugs seguem uma cauda longa: 851 (82,4%) estão em drivers, net e fs, e 588 (56,9%) só em drivers. Por densidade, o subsistema block é o mais alto, com 18 bugs em 65 KLOC.
- **Tempo de vida.** Dos 567 bugs com tag, 429 (75,7%) levaram mais de um ano para ser corrigidos, 19 viveram mais de 10 anos (7 deles de UAF) e 23 vão da v2.6 até a v5.x ou v6.x. 189 bugs foram introduzidos e corrigidos dentro da v5.x.
- **Armadilhas de API.** O `pm_runtime_get_sync` causou 94 bugs porque incrementa mesmo quando devolve um erro, e com o `kobject_init_and_add` o problema return-error soma 106. Os autores também relatam 110 bugs em caminhos de erro, 44 de liberação direta, 94 de UAD e 74 de escape. Na tabela de word2vec deles, find tem similaridade de 0,73 com get e 0,58 com put, mas valores baixos com palavras como refcount, increase e decrease, o que os autores leem como os desenvolvedores não perceberem que uma API do tipo find pega uma referência.
- **Bugs novos.** Os verificadores reportam 351 bugs: 296 vazamentos (84,3%), 48 UAF (13,7%) e 7 dereferências de ponteiro nulo (2,0%). 338 estão em arch e drivers (cerca de 96%). 240 foram confirmados e aplicados na mainline, 3 foram rejeitados, 5 são falsos positivos que não entram nos 351, e 111 ficaram sem resposta.
- **De onde vêm.** O antipadrão 4 (APIs de refcounting ocultas) responde por 255 dos 351 bugs, e as duas APIs mais frequentes são `of_find_compatible_node` (74) e `of_get_parent` (48). Todos os 17 bugs de escape foram confirmados, enquanto dois dos cinco bugs de desalocação potencial não foram, porque os desenvolvedores acreditavam que hoje nenhum UAF pode acontecer.

## Análise crítica

Os autores são abertos sobre os limites do método. Eles admitem o seguinte.

- **Escopo.** Só dois tipos de bugs são estudados, e os bugs de refcounting causados por condições de corrida ficam para depois. A coleta por palavras-chave pode perder bugs e incluir correções erradas.
- **Qualidade dos verificadores.** Os verificadores não modelam a semântica de estruturas específicas, o que gerou falsos positivos, como um incremento que um `if` de guarda torna inalcançável. Eles também usam números de linha para aproximar a ordem de execução. Dos três patches rejeitados, dois eram relatos de UAD que os desenvolvedores não consideraram bugs reais sem uma prova de conceito, e gerar uma fica como trabalho futuro.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **As contagens são de correções reportadas, não de bugs.** A fatia de vazamentos, a fatia por subsistema e o tempo de vida vêm de bugs que alguém achou e corrigiu. O próprio artigo diz que patches de UAF enfrentam uma barra alta (um relatório de crash ou uma PoC) e que PoCs são difíceis de construir, então os 71,7% de vazamentos refletem em parte o que é aceito. Os resultados de tempo de vida cobrem 55% do dataset, a parte com tag, e podem não representar o resto.
- **A gravidade é inferida, não demonstrada.** "Quase todo bug leva a um problema de segurança" se apoia em palavras-chave de mensagens de commit e no código do patch. O argumento de que vazamentos servem de via de ataque é um commit citado sobre acioná-los repetidamente por um script, e nenhuma prova de conceito é relatada para qualquer bug novo.
- **O argumento dos nomes não tem linha de base.** A tabela de word2vec cobre só APIs que causaram bugs. Ela não compara com APIs de nomes parecidos que nunca causaram um, e nenhum desenvolvedor foi perguntado se percebe o refcounting oculto. É uma leitura plausível, não uma causa testada.
- **Números que não fecham.** A introdução diz que 70,0% dos bugs levaram mais de um ano para ser corrigidos, enquanto o Finding 4 diz 75,7% (429 de 567), e uso este último. A Seção 6.2 diz que 3 patches foram rejeitados e a Seção 6.4 diz 4. 240 confirmados mais 3 rejeitados mais 111 sem resposta dá 354, não 351. A Seção 6.3 conta 62 bugs de API oculta, mas a Tabela 5 lista 42 para o antipadrão 3 e 255 para o antipadrão 4. O Finding 2 diz que a maioria dos bugs de UAF vem de misplacing, mas a Tabela 2 dá 13,9% de 28,3%, cerca de metade. O UAD aparece como 11,5% (9,1%) sem explicação da diferença.
- **Sem precisão nem recall.** A única contagem de falsos positivos são os 5 que os desenvolvedores apontaram, com 111 relatos sem resposta. Os verificadores não rodam nos kernels históricos para ver quantos dos 1.033 bugs conhecidos encontrariam, e não há comparação direta com as ferramentas do trabalho relacionado. As releases do kernel analisadas são descritas apenas como as mais recentes.
- **Poucos padrões carregam o resultado.** Um antipadrão dá cerca de 73% dos bugs novos, e duas APIs dão 122. Os verificadores também são templates escritos à mão, o que o trabalho relacionado critica em outras ferramentas por esforço manual, e esse esforço não é comparado.
- **Os conselhos não foram testados.** Convenções de nomes e comentários nas APIs são sugeridos, mas nada mede se evitariam bugs.

## Pesquisas futuras

- Detectar desvios de implementação automaticamente e publicá-los, o que o artigo aponta como um próximo passo importante.
- Gerar provas de conceito para bugs de UAD, para que os patches de UAD não sejam rejeitados por falta de um crash demonstrado.
- Bugs de refcounting causados por condições de corrida, que o artigo exclui. Uma abordagem de reordenação in-vivo como a do [OZZ](/papers/ozz-kernel-out-of-order-concurrency-bugs) é um caminho possível, sugestão minha e não do artigo.
- Medir o recall dos verificadores no dataset histórico. Uma alternativa no nível de tipos, sugestão minha e não do artigo, é o [RustBelt](/papers/rustbelt-securing-foundations-of-rust), cujos `Rc` e `Arc` verificados colocam a contagem atrás de uma interface checada.
