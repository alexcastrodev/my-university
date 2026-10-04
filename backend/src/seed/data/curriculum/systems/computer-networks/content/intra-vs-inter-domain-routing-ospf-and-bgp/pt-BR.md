---
version: 1.0
updatedAt: 2026-09-06
title: "Roteamento Intra vs. Interdomínio: OSPF e BGP"
summary: "A Internet não é um único domínio de roteamento plano, mas milhares de sistemas autônomos administrados de forma independente. O OSPF (link-state) roda o algoritmo de roteamento já coberto dentro de um AS, enquanto o BGP (path-vector, um primo do distance-vector guiado por políticas) cola os sistemas autônomos uns aos outros na escala real da Internet, onde as decisões de roteamento dizem respeito tanto a acordos comerciais quanto a caminhos mínimos."
---
## Objetivos de Aprendizagem

- Definir um sistema autônomo (AS) e explicar por que a Internet real é organizada como milhares de ASes administrados de forma independente, em vez de um único domínio de roteamento plano.
- Distinguir o roteamento intradomínio (gateway interior) do roteamento interdomínio (gateway exterior), e identificar qual protocolo real trata cada um.
- Explicar o OSPF como um protocolo link-state real e implantado, conectando-o diretamente ao algoritmo baseado em Dijkstra coberto no conceito anterior.
- Explicar por que o BGP é fundamentalmente um protocolo de políticas, e não apenas um protocolo de caminho mínimo, e dar um exemplo concreto de uma política se sobrepondo a um caminho mais curto.
- Explicar, em alto nível, por que o roteamento interdomínio na escala da Internet é tanto um problema econômico e administrativo quanto puramente técnico.

## Contexto e Motivação

O conceito anterior cobriu o roteamento link-state e distance-vector como famílias algorítmicas: Dijkstra e Bellman-Ford, aplicados num cenário distribuído. Este conceito conecta essas famílias aos protocolos reais e implantados que rodam a Internet de verdade, e introduz um fato estrutural que o enquadramento algorítmico limpo do conceito anterior deixou de lado por simplicidade: a Internet não é uma única rede onde todo roteador participa de um cálculo de roteamento compartilhado. Ela é milhares de redes administradas de forma independente (os sistemas autônomos), cada uma rodando o seu próprio roteamento interno, conectadas umas às outras por um protocolo separado, construído para tratar o problema genuinamente diferente de rotear entre organizações que não confiam totalmente umas nas outras e não querem expor a estrutura interna das suas redes.

## Teoria Central

### Sistemas autônomos

Um sistema autônomo (AS) é uma rede, ou um grupo de redes, sob um único controle administrativo (um provedor de acesso, uma universidade, a rede de uma grande empresa), com a sua própria política de roteamento interna, identificado por um número de AS globalmente único. A Internet real consiste em muitos milhares desses sistemas autônomos, interconectados via acordos (relações comerciais, arranjos de peering) que são tanto econômicos e contratuais quanto técnicos. Rotear dentro de um único AS é um problema fundamentalmente diferente de rotear entre sistemas autônomos diferentes, e a Internet usa duas famílias de protocolos inteiramente separadas para tratá-los.

### Roteamento intradomínio: OSPF

O roteamento intradomínio (ou de gateway interior) opera dentro de um único sistema autônomo, onde todo roteador está sob o mesmo controle administrativo e, crucialmente, pode razoavelmente confiar nas informações anunciadas por todos os outros roteadores. O OSPF (Open Shortest Path First) é o protocolo link-state real e implantado dominante usado para isso: todo roteador dentro do AS inunda informações de estado de enlace para todos os outros roteadores dentro desse mesmo AS, e cada roteador roda o algoritmo de Dijkstra (exatamente o algoritmo e o mecanismo de inundação já cobertos no conceito anterior) para calcular os caminhos mínimos até todos os outros roteadores dentro do seu próprio AS. O OSPF é, concretamente, o roteamento link-state já coberto, implantado em escala real e operacional dentro de um único domínio administrativo.

### Roteamento interdomínio: BGP

O roteamento interdomínio (ou de gateway exterior) opera entre sistemas autônomos diferentes, onde não existe essa confiança mútua nem um controle administrativo compartilhado: um AS geralmente não quer expor a sua topologia interna completa a outros ASes operados de forma independente, e ASes diferentes podem ter interesses comerciais reais e conflitantes sobre como o tráfego flui entre eles. O BGP (Border Gateway Protocol) é o protocolo único que cola todos os sistemas autônomos da Internet uns aos outros, e ele é estruturalmente um protocolo parecido com o distance-vector (cada AS anuncia aos seus ASes vizinhos os caminhos em nível de AS que conhece até vários destinos, em vez de inundar uma topologia completa). Mas o BGP é descrito com mais precisão como um protocolo path-vector: cada anúncio inclui a sequência inteira de números de AS pela qual o caminho passa, e não meramente um número de distância/custo. Isso permite que um AS receptor detecte e evite laços de roteamento diretamente (um roteador simplesmente recusa um caminho que já contém o seu próprio número de AS), em vez de precisar da convergência iterativa do distance-vector, mais propensa a falhas.

### O BGP é um protocolo de políticas, não um protocolo de caminho mínimo

A coisa genuinamente importante, e às vezes surpreendente, sobre o BGP é que ele não seleciona simplesmente o caminho de AS mais curto disponível: ele seleciona o caminho que melhor satisfaz as políticas comerciais e administrativas de cada AS, que podem se sobrepor, e frequentemente se sobrepõem, a um caminho mais curto por completo. Um AS pode preferir rotear o tráfego por um parceiro comercial com quem tem um acordo financeiro favorável, mesmo que exista um caminho tecnicamente mais curto por outro AS com quem não tem esse arranjo, ou pode se recusar a transportar certo tráfego pela sua rede por completo, por razões de política que nada têm a ver com o comprimento do caminho. Este é um afastamento genuíno e deliberado da otimização pura de caminho mínimo que o OSPF (e o Dijkstra por baixo dele) realiza dentro de um único AS: na escala da Internet, entre organizações operadas de forma independente com interesses reais e concorrentes, "mais curto" simplesmente não é o único critério que importa, nem mesmo o principal.

### Por que esta estrutura em dois níveis existe

Rodar um único protocolo de roteamento plano pela Internet inteira (todo roteador em todo lugar participando de um único cálculo compartilhado) seria ao mesmo tempo tecnicamente inviável nessa escala (a inundação link-state para todos os roteadores do planeta, ou a convergência iterativa de Bellman-Ford por todos os roteadores do planeta, seria enormemente lenta e intensiva em recursos) e organizacionalmente impraticável (nenhum AS quer expor a sua estrutura interna completa a todos os outros ASes, e nenhuma política de roteamento única poderia satisfazer os interesses comerciais independentes de todos os ASes ao mesmo tempo). A estrutura em dois níveis (OSPF rápido, baseado em confiança e de caminho mínimo dentro de um AS; BGP mais lento, guiado por políticas e seguro contra laços entre ASes) é a resposta real e implantada da Internet a essas duas restrições genuínas.

## Exemplos Resolvidos

### Exemplo 1: O OSPF como Dijkstra implantado, dentro de um AS

A rede de uma universidade (um único AS) tem os roteadores de R1 a R5, conectados internamente. O OSPF inunda informações de estado de enlace só entre esses cinco roteadores (nunca além da fronteira da rede da própria universidade), e cada roteador roda o algoritmo de Dijkstra sobre essa topologia interna para calcular os seus próprios caminhos mínimos até todos os outros roteadores dentro da rede da universidade. Isto é idêntico, em mecanismo, ao exemplo link-state já resolvido no conceito anterior: o OSPF é esse mecanismo, com um nome e implantado em escala real e operacional.

### Exemplo 2: A prevenção de laços path-vector do BGP

O AS 100 anuncia ao AS 200 um caminho até algum destino como: "AS-PATH: 100." O AS 200, ao receber isso, acrescenta o seu próprio número de AS no início antes de reanunciá-lo adiante: "AS-PATH: 200, 100." Se esse anúncio eventualmente voltar ao AS 100 por algum outro caminho (digamos, pelo AS 300) como "AS-PATH: 300, 200, 100", o AS 100 reconhece imediatamente o seu próprio número de AS já presente no caminho e o rejeita, evitando um laço de roteamento diretamente, a partir da própria informação explícita do caminho, sem precisar de nenhum processo iterativo de convergência por comparação de distâncias, como o roteamento distance-vector puro precisaria.

### Exemplo 3: Uma política se sobrepondo ao caminho mínimo

O AS X consegue alcançar um destino por dois caminhos possíveis: o Caminho A, pelo AS Y, com um comprimento de AS-path de 2 saltos; o Caminho B, pelo AS Z, com um comprimento de AS-path de 4 saltos (mais longo). O AS X tem um acordo comercial (de peering) com o AS Z que torna o roteamento por Z financeiramente favorável, e nenhum acordo favorável assim com o AS Y.

```text
AS-path mais curto:  via Y (2 saltos)
Escolha real de política do AS X:  via Z (4 saltos), escolhido
  especificamente por causa da relação comercial, apesar de ser mais longo
```

Isto não é um defeito nem um erro de roteamento: é o BGP se comportando exatamente como projetado. O comprimento do caminho é só uma entrada entre várias que a política de roteamento de um AS real pode pesar, e considerações comerciais e administrativas podem, e rotineiramente o fazem, se sobrepor legitimamente a um caminho disponível mais curto.

## Equívocos Comuns e Armadilhas

- **"O BGP é só o roteamento distance-vector numa escala maior."** O BGP é com mais precisão um protocolo path-vector: cada anúncio carrega o AS-path completo, e não meramente um número de distância. É especificamente isso que permite a ele detectar e evitar laços de roteamento diretamente (verificando se o seu próprio número de AS aparece num caminho anunciado), em vez de depender do processo de convergência mais lento e mais propenso a falhas do distance-vector. Ele também é explicitamente guiado por políticas, diferente de um protocolo distance-vector "puro" de caminho mínimo.
- **"O OSPF e o BGP resolvem o mesmo problema em escalas diferentes."** Eles resolvem problemas genuinamente diferentes: o OSPF calcula caminhos mínimos dentro de um domínio administrativo confiável; o BGP negocia alcançabilidade e políticas entre domínios operados de forma independente e que não confiam uns nos outros. A dimensão de confiança e de políticas, ausente dentro de um único AS, é toda a razão de ser do BGP ter uma estrutura tão diferente da do OSPF.
- **"A Internet funcionaria melhor com um protocolo de roteamento unificado em vez de dois níveis."** Um único protocolo plano seria tecnicamente inviável em escala global (inundação ou convergência iterativa por todos os roteadores do planeta) e organizacionalmente impossível (não existe confiança compartilhada nem política unificada entre organizações operadas de forma independente). A divisão em dois níveis, intradomínio e interdomínio, é uma resposta real e necessária às duas restrições, e não um acidente histórico arbitrário.
- **"O caminho mínimo é sempre o resultado correto ou esperado do roteamento."** Dentro de um único AS (OSPF), sim: é exatamente isso que o link-state/Dijkstra otimiza. Entre sistemas autônomos (BGP), o comprimento do caminho é só um fator entre várias considerações reais de negócio e de política, e um caminho mais longo é frequente e legitimamente escolhido em vez de um mais curto.

## Resumo

A Internet real não é um único domínio de roteamento plano: ela é milhares de sistemas autônomos (ASes) administrados de forma independente, cada um rodando roteamento intradomínio internamente (o OSPF, um protocolo link-state real e implantado, construído diretamente sobre o mecanismo baseado em Dijkstra já coberto) e conectados uns aos outros via roteamento interdomínio (o BGP, um protocolo path-vector estruturalmente relacionado ao roteamento distance-vector, mas explicitamente guiado pelas políticas comerciais e administrativas de cada AS, e não pela otimização pura de caminho mínimo). O projeto path-vector do BGP (anunciar o AS-path completo, e não só uma distância) é o que permite a ele detectar e rejeitar laços de roteamento diretamente, e a sua seleção de rotas guiada por políticas significa que um caminho tecnicamente mais longo é rotineira e legitimamente escolhido em vez de um mais curto quando considerações comerciais o favorecem. Esta estrutura em dois níveis (rápida e baseada em confiança dentro de um AS, mais lenta e negociada por políticas entre ASes) é a resposta prática e implantada da Internet real ao roteamento numa escala e através de um cenário organizacional que nenhum protocolo plano único conseguiria tratar. Isto conclui o bloco de Camada de Rede; o próximo bloco desce mais uma camada, para o enquadramento de salto único e a detecção de erros da camada de enlace.

## Documentation Links

- [ACM/IEEE CS2013: Networking and Communication Knowledge Area](https://csed.acm.org/knowledge-areas-networking-and-communication-nc-cs2013-version/): diretrizes curriculares que listam o roteamento intra e interdomínio entre as unidades de conhecimento centrais da área.
- [Kurose & Ross: Computer Networking: A Top-Down Approach (site oficial de apoio)](https://gaia.cs.umass.edu/kurose_ross/index.php): o tratamento do livro-texto padrão do OSPF, do BGP, dos sistemas autônomos e das políticas de roteamento interdomínio.
