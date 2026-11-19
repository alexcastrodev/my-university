---
title: "Meltdown: lendo a memória do kernel a partir do espaço do usuário"
summary: Em muitas CPUs Intel, um programa sem privilégios consegue carregar um endereço do kernel, tomar a falha de permissão e ainda assim vazar o valor pelo cache, porque a execução fora de ordem roda as instruções seguintes antes de a falha ser tratada. Tirar o kernel das tabelas de páginas do usuário (KAISER, depois KPTI) impede o ataque.
researchArea: Segurança e privacidade
keywords: meltdown, execução fora de ordem, isolamento do kernel, canal lateral de cache, Flush+Reload, KAISER, KPTI
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

A segurança dos sistemas computacionais depende fundamentalmente do isolamento de memória, por exemplo, os intervalos de endereços do kernel são marcados como inacessíveis e protegidos do acesso do usuário. Neste artigo, apresentamos o Meltdown. O Meltdown explora efeitos colaterais da execução fora de ordem em processadores modernos para ler posições arbitrárias da memória do kernel, incluindo dados pessoais e senhas. A execução fora de ordem é um recurso de desempenho indispensável e presente em uma ampla gama de processadores modernos. O ataque é independente do sistema operacional e não depende de nenhuma vulnerabilidade de software. O Meltdown quebra todas as garantias de segurança oferecidas pelo isolamento de espaços de endereços, bem como por ambientes paravirtualizados e, portanto, todo mecanismo de segurança construído sobre essa base. Em sistemas afetados, o Meltdown permite que um adversário leia a memória de outros processos ou de máquinas virtuais na nuvem sem quaisquer permissões ou privilégios, afetando milhões de clientes e praticamente todo usuário de computador pessoal. Mostramos que o mecanismo de defesa KAISER, criado para o KASLR, tem o efeito colateral importante (mas não intencional) de impedir o Meltdown. Enfatizamos que o KAISER deve ser implantado imediatamente para evitar a exploração em larga escala desse grave vazamento de informação.

## Visão geral

Os sistemas operacionais mapeiam o kernel inteiro, e com ele toda a memória física, no espaço de endereços de cada processo, e contam com um bit de supervisor nas tabelas de páginas para manter o código do usuário de fora. É o tipo de proteção reforçada por hardware discutido em [The Protection of Information in Computer Systems](/papers/protection-of-information-in-computer-systems). O artigo, de doze autores da Graz University of Technology, Cyberus Technology, G DATA, Google Project Zero, University of Michigan, University of Adelaide e Data61 e Rambus (divisão de pesquisa em criptografia), saiu no 27th USENIX Security Symposium (Baltimore, agosto de 2018). Vários autores descobriram a falha de forma independente e publicaram juntos após uma divulgação coordenada (CVE-2017-5754).

Ele é o irmão do [Spectre](/papers/spectre-attacks-exploiting-speculative-execution), publicado na mesma época. A distinção do próprio artigo: o Meltdown rompe a fronteira de privilégio e não exige adaptação à vítima, enquanto o Spectre vale para mais CPUs, mas exige conhecer o código da vítima e não é barrado pelo KAISER.

Vale conhecer antes: memória virtual e os bits de permissão das tabelas de páginas, como um pipeline fora de ordem aposenta instruções em ordem e o que é um canal lateral de tempo no cache.

## Contribuição

- **A execução fora de ordem como canal lateral alcançável por software.** A CPU executa instruções depois de uma carga que falha antes de tratar a falha, e o cache guarda um rastro desse trabalho.
- **Um ataque de ponta a ponta** que lê memória arbitrária do kernel e física a partir de um processo sem privilégios, em notebooks, desktops, um celular e VMs na nuvem, sem nenhum bug de software.
- **Duas estratégias para a exceção:** capturá-la (fork e queda do filho, ou um tratador de sinal) ou suprimi-la com transações Intel TSX.
- **Uma avaliação do KAISER** como defesa acidental, mais uma discussão de correções em hardware, como um bit de divisão rígida entre as metades de usuário e de kernel do espaço de endereços.

## Metodologia

O ataque supõe código arbitrário sem privilégios na máquina, com ASLR, KASLR, SMAP, SMEP e NX ligados, e um kernel sem bugs. Tem três passos. Passo 1: carregar um byte de um endereço de kernel inacessível num registrador. Passo 2: uma instrução transitória usa esse registrador para tocar uma linha de um array de prova de 256 x 4096 bytes, de modo que o segredo escolhe a página. Passo 3: o Flush+Reload sobre as 256 páginas mostra qual está no cache, e essa é o segredo. A falha só é levantada quando a carga se aposenta, e a sequência transitória disputa uma corrida com ela.

O artigo lida com a corrida com um laço de repetição (a carga muitas vezes devolve 0, um viés que os autores atribuem a uma verificação de permissão que mascara a carga ou a um valor especulado), lendo um bit por transmissão (uma medição de Flush+Reload em vez de 256), mantendo a tradução do array de prova no TLB e fazendo prefetch do endereço do kernel. Com KASLR o mapa direto da memória física é randomizado em 40 bits, mas com 8 GB de RAM bastam no máximo 128 sondagens em passos de 8 GB para achá-lo.

A avaliação (Tabela 1) lista nove CPUs Intel de laboratório (Celeron G540, Core i5-3230M, i5-3320M, i7-4790, i5-6200U, i7-6600U, i7-6700K, i7-8700K e Xeon E5-1630 v3), dois Xeons na nuvem (E5-2676 v3 e E5-2650 v4, na Amazon EC2 e na DigitalOcean) e o SoC de celular Samsung Exynos 8890. As taxas e os erros foram medidos vazando valores conhecidos do kernel.

## Resultados

- **Taxas de leitura.** O texto diz de 3,2 KB/s a 503 KB/s na introdução, na Seção 5 e na conclusão, mas a Seção 6.2 relata até 582 KB/s (média 552,4, sigma 10,2) com erro de até 0,003% no i7-8700K, 569 KB/s (média 515,5) com 0,002% no i7-6700K e 491 KB/s (média 466,3) com erro mínimo de 10,7% no Xeon E5-1630, onde uma versão de 137 KB/s chegou a erro zero. Dados no L3 mas não no L1 deram 12,4 KB/s no i7-6700K; dados fora do cache deram menos de 10 B/s na maioria dos sistemas e 3,2 KB/s com truques de prefetch. Há números por CPU só para essas três, todos com TSX.
- **Viés para zero.** No i5-6200U com tratamento de exceção, leu-se 0 em 5,25% das vezes sem otimização e 0,67% com repetições; no i7-8700K, 1,78%; com TSX, 0,008%.
- **Linux, Windows, Android.** O Linux 2.6.32 a 4.13.0 sem KAISER vaza toda a memória física. O Windows 10 vaza qualquer memória mapeada no kernel, inclusive o binário do kernel, conferido com o depurador do kernel. Num Galaxy S7 (kernel 3.18.14) funcionou nos núcleos customizados da Samsung, vazando uma string predefinida, mas não no Cortex-A53.
- **Contêineres.** Docker, LXC e OpenVZ compartilham um único kernel, e os autores vazaram memória de um contêiner de outro usuário sob controle deles.
- **Nuvem.** O Meltdown funcionou dentro de VMs na EC2 e na DigitalOcean, mas por razões éticas os autores não leram memória de outros inquilinos.
- **AMD e ARM.** Sem sucesso na AMD nem em outros núcleos ARM. A AMD declarou não ser afetada, e a ARM cita apenas o Cortex-A75, que os autores não tinham. O exemplo de brinquedo, de um acesso depois de uma falha, ainda deixa rastro no cache nas duas.
- **KAISER.** Verificado no Linux: impede o vazamento de memória do kernel e física, exceto alguns quilobytes que o x86 exige nos mapeamentos do usuário, que podem conter ponteiros capazes de quebrar o KASLR. O Linux o renomeou para KPTI; o Windows tem o KVA Shadow e a Apple adicionou o Double Map. O artigo não traz nenhuma medição de lentidão do KAISER.

## Análise crítica

O que o artigo não afirma. Ele não demonstra fuga de VM: o caso do Xen em paravirtualização é argumentado na introdução, mas nenhum experimento com Xen aparece no texto. Os resultados na nuvem mostram só leitura do kernel dentro da própria VM. A AMD e a maioria dos núcleos ARM não foram quebrados, e o "microarquiteturas Intel modernas desde 2010" da introdução se apoia nos modelos de CPU listados, que o artigo não associa a gerações. Os custos são discutidos de forma qualitativa: serializar a verificação de permissão é chamado de sobrecarga significativa por acesso, espera-se que o bit de divisão rígida custe pouco (uma expectativa, não uma medição) e diz-se que provedores de contêineres teriam custos significativamente maiores com virtualização completa ou KAISER. A divergência entre 503 e 582 KB/s é uma inconsistência interna a ter em mente.

Literatura posterior, fora deste artigo. Li apenas o resumo de Canella et al., "A Systematic Evaluation of Transient Execution Attacks and Defenses" (arXiv 1811.05441, novembro de 2018): ele relata novas variantes do Meltdown (Meltdown-PK na Intel, Meltdown-BND na Intel e na AMD) e que a maioria das defesas, inclusive as já implantadas, não mitiga todas as variantes. Não li o corpo do texto. Existe uma versão do Meltdown na CACM (2020, o Crossref lista um autor a mais); não a li, nem li qualquer estudo de desempenho do KPTI.

Para contexto, [Xen and the Art of Virtualization](/papers/xen-and-the-art-of-virtualization) e o [Firecracker](/papers/firecracker-lightweight-virtualization-for-serverless-applications) são os projetos de hipervisor e de microVM por trás das escolhas de isolamento que o artigo discute; nenhum dos dois é citado por ele.

## Pesquisas futuras

- Correções em hardware que verifiquem as permissões antes de encaminhar o dado carregado, como o bit de divisão rígida do artigo, e quanto custam.
- Outros estados microarquiteturais além do cache como canal encoberto, que o artigo menciona (por exemplo, a disputa por portas de execução).
- A questão dos dados fora do cache, que os autores suspeitam envolver os line fill buffers e deixam em aberto.
- As páginas de kernel ainda mapeadas no usuário sob o KAISER, incluindo a ideia de trampolins para esconder ponteiros do kernel.
